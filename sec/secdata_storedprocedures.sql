DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `addExemptOfferingPersons`(IN `ADSH` VARCHAR(20))
    NO SQL
BEGIN

    IF CHAR_LENGTH(ADSH)=20 THEN
        DELETE FROM edgar_names where edgar_names.adsh = ADSH;
        insert into edgar_names (adsh, cik, name_ci, lastname_soundex)
          select adsh, personnum, concat(lastName,' ',firstName,' ', coalesce(MiddleName,'')), soundex(lastName) 
          from exemptOfferingPersons eop where eop.adsh=ADSH;
	END IF;
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `listFinancialStatements`(IN `CIK` INT)
    NO SQL
BEGIN

SELECT cik, concat('[', GROUP_CONCAT(concat('{"accn":"', adsh, '","form":"', form, '","fp":"', fp, '","fy":"', fy, '","filed":"',filed,'"}') order by fy desc, fp desc, filed, form), ']') as jsonList
FROM f_sub s 
where s.cik=CIK
group by s.cik;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `countStandardTags`(IN `recs` INT)
    NO SQL
BEGIN 
#var decs
DECLARE i INT DEFAULT 0;
DECLARE terminate INTEGER DEFAULT 0;
DECLARE currenttag varchar(255);

#cursors decs
DECLARE tags CURSOR FOR select tag from f_num;
DECLARE CONTINUE HANDLER 
        FOR NOT FOUND SET terminate = 1;

update standardtag set cnt = 0;

open tags;
tag_loop: LOOP

  FETCH tags INTO currenttag;
  SET i = i + 1;
  IF (terminate = 1 OR (i>recs and recs<>0)) THEN
    LEAVE tag_loop;
  END IF;
  
  update standardtag st 
    set st.cnt = st.cnt + 1
    where st.tag = currenttag;

END LOOP;

CLOSE tags;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeAnalytics`()
    NO SQL
BEGIN
  CALL makeStandardTags();
  CALL makeTimeSeries(0);
  CALL makeFacts();
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeStandardTags`()
    NO SQL
BEGIN
  
  CREATE TABLE standardtagWrk (
    tag varchar(255)  PRIMARY KEY,
    maxversion varchar(50),
    label  varchar(512) NULL,
    description  varchar(2048) NULL,
    cnt int DEFAULT 0
  );
  
  INSERT INTO standardtagWrk (tag, maxversion) 
     SELECT tag, version from f_tag
     WHERE custom=0
     ON duplicate key 
       update maxversion = if(maxversion<version, version, maxversion);
     
  UPDATE standardtagWrk st, f_tag t
    SET st.label = t.tlabel, st.description = t.doc
    WHERE st.tag = t.tag and st.maxversion = t.version;

  START TRANSACTION;
    DROP TABLE IF EXISTS standardtag;
    RENAME TABLE standardtagWrk TO standardtag;
  COMMIT;

# remove the follow after switch to new parser that scraped start and end period dates and calculates the ccp (closet calendrical period)
  update f_num 
    set enddate=ddate, startdate = date_sub(ddate, interval qtrs quarter), ccp=concat('CY',year(date_sub(ddate, interval 40 day)),'Q',quarter(date_sub(ddate, interval 40 day))) 
    where qtrs = 1 and adsh<>version and coreg='' and value is not null;
  update f_num 
    set enddate=ddate, startdate = null, ccp=concat('CY',year(date_sub(ddate, interval 40 day)),'Q',quarter(date_sub(ddate, interval 40 day)),'I') 
    where qtrs = 0 and adsh<>version and coreg='' and value is not null;
  update f_num 
    set enddate=ddate, startdate = date_sub(ddate, interval qtrs quarter), ccp=concat('CY',year(date_sub(ddate, interval 180 day))) 
    where qtrs = 4 and adsh<>version and coreg='' and value is not null;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeTimeSeries`()
    NO SQL
BEGIN
#OLD: added index, created 3.8M times series & drop index in 28m
#NEW: create 3.8M times series & drop index in 28m
DECLARE currentCik INT;
#DECLARE currentCoName VARCHAR(150);
DECLARE terminate INTEGER DEFAULT 0;
DECLARE ciks CURSOR FOR
  SELECT DISTINCT cik FROM f_sub;
DECLARE CONTINUE HANDLER 
        FOR NOT FOUND SET terminate = 1;
        
truncate table timeseries;
ALTER TABLE timeseries
  DROP PRIMARY KEY,
  Drop KEY ixtimeseries_tag;

#CREATE TEMPORARY TABLE tmp_adsh select adsh, name, sic, fy, fp, form from f_sub limit 0;

Open ciks;
cik_loop: LOOP

  FETCH ciks INTO currentCik;
  IF terminate = 1 THEN
    LEAVE cik_loop;
  END IF;
 
  #create a tmp table of just the adsh for this cik (b/c mysql is incompetent at optimizing this query)
  #TRUNCATE TABLE tmp_adsh;
  #insert into tmp_adsh  select adsh, name, sic, fy, fp, form from f_sub where cik = currentCik;
 
  #insert the cik’s f_num records into temp table
#  CREATE TEMPORARY TABLE standard_pts 
#    SELECT n.adsh, n.tag, n.uom, n.qtrs, n.value, n.ddate, name, sic, fy, fp, form
#    FROM f_num n inner join tmp_adsh ta on n.adsh=ta.adsh
#    WHERE n.version <> n.adsh and coreg="" and qtrs in (0,1,4);

  INSERT INTO timeseries (cik, tag, uom, qtrs, pts, json) 
    Select currentCik, 
       tag, 
       uom, 
       qtrs, 
       count(*),
       CONCAT("[",  GROUP_CONCAT(CONCAT('{"start":', coalesce(concat('"', startdate,'"'),'null'), ',"end":"', enddate, '","val":', value, ',"accn":"', adsh, '","fy":', fy, ',"fp":"', fp, '","form":"', form, '"}') ORDER BY enddate ASC, adsh DESC SEPARATOR ","), "]") 
     FROM (
         SELECT n.adsh, n.tag, n.uom, n.qtrs, n.value, n.startdate, n.enddate, name, sic, fy, fp, form
         FROM f_num n 
         INNER JOIN f_sub s on n.adsh=s.adsh
         WHERE n.ccp is not null AND s.cik = currentCik
     ) standard_pts 
     group by tag, uom, qtrs;

#  DROP TEMPORARY TABLE IF EXISTS standard_pts;

END LOOP cik_loop;

#release resources
CLOSE ciks;

#DROP TEMPORARY TABLE IF EXISTS tmp_adsh;

ALTER TABLE `timeseries`
  ADD PRIMARY KEY (`cik`,`tag`,`uom`,`qtrs`),
  ADD KEY `ixtimeseries_tag` (`tag`);
  
#final update of timeseries’ co name, tag name, and tag description from f-tag and f_sub

#get latest definition of all standard tag into temp table
UPDATE standardtag st, timeseries ts
set ts.label=st.label, ts.description=st.description
where ts.tag=st.tag;

#get latest company name too
update timeseries ts 
  inner join f_sub s on ts.cik = s.cik 
  inner join (select max(period) as period, cik from f_sub group by cik) mxs on mxs.cik = s.cik and mxs.period = s.period 
set ts.entityName = s.name;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `searchNames`(IN `lastname` VARCHAR(255) CHARSET latin1, IN `firstname` VARCHAR(255) CHARSET latin1, IN `middlename` VARCHAR(255) CHARSET latin1)
    NO SQL
BEGIN

#names are expected to be words, initals or NULL
#honorifics, title and suffixes (eg. Dr, PhD, Jr, Sr) should be omitted
DECLARE hasFirst bit default firstname is not null and firstname <> '';
DECLARE hasMiddle bit default middlename is not null and middlename <> '';

#search patterns for first and middle names and initials
declare exactFirst varchar(255) default if(hasFirst, concat(' ', firstname), '');
declare exactMiddle varchar(255) default if(hasMiddle, concat(' ', middlename), '');
declare exactFI varchar(10) default if(hasFirst, concat(' ', substring(firstname from 1 for 1)), '');
declare exactMI varchar(10) default if(hasMiddle, concat(' ', substring(middlename from 1 for 1)), '');

declare likeFI varchar(10) default if(hasFirst, concat(' ', substring(firstname from 1 for 1),'%'), '');
declare likeMI varchar(10) default if(hasMiddle, concat(' ', substring(middlename from 1 for 1),'%'), '');

SET NAMES 'latin1' COLLATE 'latin1_general_ci';

Create temporary table matches 
  (cik varchar(20) UNIQUE KEY, name varchar(512), rank tinyint);

#exact match of last name + match of first & middle names/initials WITHOUT contradictions
insert into matches 
   	select en.cik, GROUP_CONCAT(name_ci SEPARATOR ' <br><i>also filed as</i> '), 1 
   	from edgar_names en
    where name_ci like concat(lastname,' %') COLLATE latin1_general_ci and (
        name_ci rlike concat('^', lastname, exactFirst, '[a-zA-Z]*', exactMiddle) COLLATE latin1_general_ci	
    	or name_ci rlike concat('^', lastname, exactFirst, exactMI,'[[:>:]]') COLLATE latin1_general_ci	
    	or name_ci rlike concat('^', lastname, exactFI, exactMiddle,'[[:>:]]') COLLATE latin1_general_ci	
    	or name_ci rlike concat('^', lastname, exactFI, exactMI,'[[:>:]]') COLLATE latin1_general_ci)
  	GROUP BY en.cik;
        
#exact match of last name + match of first & middle initial WITH possible contradictions
insert into matches 
	select en.cik, name_ci, 2 as rank 
    from edgar_names en
    where name_ci like concat(lastname, likeFI, likeMI) COLLATE latin1_general_ci	
    	or name_ci like concat(lastname, likeMI, likeFI) COLLATE latin1_general_ci
    on duplicate key update matches.cik=en.cik;  
    
   
/*#either first or middle initials match full names 
insert into matches select en.cik, name_ci, 3 from edgar_names en
    where (name_ci LIKE concat(lastname, likeFI) COLLATE latin1_general_ci and hasFirst) 
    or (name_ci LIKE concat(lastname, likeMi) COLLATE latin1_general_ci and hasMiddle) 	
    on duplicate key update cik=cik; */
#soundex lastname + 

insert into matches select * from (select en.cik,  GROUP_CONCAT(name_ci SEPARATOR ' <br><i>also files as</i> ') as names, 4 
    from edgar_names en
    where lastname_soundex = soundex(lastname) COLLATE latin1_general_ci
    and ((not hasFirst) or name_ci RLIKE exactFI COLLATE latin1_general_ci)
   AND ((not hasMiddle) or name_ci RLIKE exactMI COLLATE latin1_general_ci) 
   GROUP  BY en.cik) sm
    on duplicate key update matches.cik=sm.cik; 

select * from matches;

drop temporary table matches;
  
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeFrames`()
    NO SQL
BEGIN
#creates 408K records in 28min on a M5.XL (note: 138K are sinlge pt frames)
#variable declarations
DECLARE currentTag varchar(255);
DECLARE currentLabel varchar(512);
DECLARE currentDescription varchar(2048);
DECLARE terminate INT DEFAULT 0;
DECLARE i INT DEFAULT 0;

#cursor declarations
DECLARE cr_standardTags CURSOR FOR 
  SELECT tag, label, description FROM standardtag st;
  #WHERE tag = 'NetIncomeLoss';  #testing muzzle = comment out to build!
DECLARE CONTINUE HANDLER FOR NOT FOUND SET terminate = 1;

TRUNCATE TABLE frames;

#double the max size to 2 MB for group_concat and concat
set @@session.group_concat_max_len = 1048576 * 2;
set @@global.max_allowed_packet = 1048576 * 2;

Open cr_standardTags;
st_loop: LOOP #OUTTER LOOP = TAG -> crunch all frames for a given tag at the same time
  	FETCH cr_standardTags INTO currentTag, currentLabel, currentDescription; 
  	IF terminate = 1 THEN
    	LEAVE st_loop;
  	END IF;

    # regular table = not thread safe for multiple simultaneous procedures
    # note: can't include company (name) in case of change
    TRUNCATE TABLE frame_working;
    #frames contains the row of the last filed value + versions fields to indicate revisions
    INSERT INTO frame_working  (tag, ccp, uom, cik, maxfiled) 
    	select currentTag, n.ccp, n.uom, cik, max(filed) as maxfiled
        from f_num n inner join f_sub s on n.adsh=s.adsh
        where n.tag = currentTag AND n.ccp is not null
        group by n.ccp, n.uom, s.cik;
        
    #create frames for this (tag, cdate, qtrs, uom)
    INSERT INTO frames (tag, ccp, uom, qtrs, label, description, pts, json)
SELECT fw.tag, fw.ccp, fw.uom, n.qtrs, currentLabel, currentDescription, count(*) as pts, 
         CONCAT('[', GROUP_CONCAT(CONCAT('{"accn":"', s.adsh, '","cik":', fw.cik, ',"entityName":"', jclean(s.name),'","sic":', s.sic, ',"loc":"', 
         	COALESCE(s.countryba, s.countryma,''),'-', COALESCE(s.stprba, s.stprma,''),'"',coalesce(concat(',"start":"',n.startdate,'"'),
            ''),',"end":"', n.enddate, '","val":', n.value, '}')), ']')
       FROM frame_working fw
       inner join f_sub s on fw.cik = s.cik and fw.maxfiled=s.filed
       inner join f_num n USE INDEX (tagccpuom, ix_adshtag) on  fw.tag=n.tag and fw.ccp=n.ccp and fw.uom=n.uom and s.adsh=n.adsh
       group by fw.tag, fw.ccp, fw.uom;
    #note: can skip qtrs in group by and more becuase ccp uniquely combines enddate and qtrs


END LOOP st_loop;

#release resources and cleanup
CLOSE cr_standardTags;


END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeOwnershipAPI`()
    NO SQL
BEGIN
#executes in 5 minutes (Python writer to S3 another 30 minutes for 175K objects)

TRUNCATE ownership_api_reporter;
TRUNCATE ownership_api_issuer;

SET SESSION group_concat_max_len = 16000000; # 8MB
SET GLOBAL max_allowed_packet = 16000000; # 8MB

#ISSUERS
INSERT into ownership_api_issuer (cik, transactions, lastfiledt)
select s.issuercik,
	concat(
      '[["',
      GROUP_CONCAT(
         concat_ws(
           '","',s.form, s.adsh, t.transnum,
           coalesce(t.transcode, ''),
           coalesce(t.acquiredisposed, ''),
           coalesce(t.directindirect, ''),
           coalesce(t.transdt,''),
           concat(substring(filedt,1,4),'-',substring(filedt,5,2),'-',substring(filedt,7,2)),
           jclean(r.ownername), 
           r.ownercik, 
           coalesce(t.shares,''),
           coalesce(t.sharesownedafter, ''),
           jclean(t.security)
         ) ORDER BY coalesce(t.transdt, s.filedt) desc SEPARATOR '"],["'
      ),
      '"]]'
    ),
    max(s.filedt)
from ownership_submission s
  INNER JOIN ownership_reporter r on r.adsh = s.adsh
  INNER JOIN ownership_transaction t on t.adsh = s.adsh
where r.ownernum = 1 and t.transtype='T'
group by s.issuercik;

Update ownership_api_issuer a, 
  (select max(filed) as lastfiledt, cik from f_sub group by cik) s
  set a.lastfiledt = s.lastfiledt
  WHERE a.cik=s.cik;
  
Update ownership_api_issuer a, f_sub s
  set a.name = s.name,
    a.mastreet1 =  s.mas1,
    a.mastreet2 =  s.mas2,
    a.macity = s.cityma,
    a.mastate = s.stprma,
    a.mazip =  s.zipma,                           
    a.bastreet1 = s.bas1,
    a.bastreet2 = s.bas2,
    a.bacity = s.cityba,
    a.bastate = s.stprba, 
    a.bazip = s.zipba
  WHERE a.cik=s.cik and a.lastfiledt = s.filed;  


#REPORTERS
INSERT into ownership_api_reporter (cik, transactions, lastfiledt)
select r.ownercik,
	concat('[["',
       GROUP_CONCAT(
         concat_ws(
           '","',s.form, s.adsh, t.transnum,
           coalesce(t.transcode, ''),
           coalesce(t.acquiredisposed, ''),
           coalesce(t.directindirect, ''),
           coalesce(t.transdt,''),
           concat(substring(filedt,1,4),'-',substring(filedt,5,2),'-',substring(filedt,7,2)),
           jclean(s.issuername), 
           s.issuercik, 
           coalesce(t.shares,''),
           coalesce(t.sharesownedafter, ''),
           jclean(t.security)
         ) ORDER BY coalesce(t.transdt, s.filedt) desc SEPARATOR '"],["'
       ),
       '"]]'
    ),
    max(s.filedt)
from ownership_submission s
  INNER JOIN ownership_reporter r on r.adsh = s.adsh
  INNER JOIN ownership_transaction t on t.adsh = s.adsh
group by r.ownercik;

Update ownership_api_reporter a,
 ownership_reporter r,
 ownership_submission s 
set a.name = r.ownername,
  a.mastreet1=r.ownerstreet1,
  a.mastreet2=r.ownerstreet2,
  a.macity=r.ownercity,
  a.mastate=r.ownerstate,
  a.mazip=r.ownerzip                       
  WHERE a.cik=r.ownercik and  a.lastfiledt=s.filedt and r.adsh=s.adsh;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `submissionAdd`(IN `NEWPATH` VARCHAR(128), IN `NEWADT` VARCHAR(128), IN `NEWSUBMISSION` MEDIUMTEXT)
    NO SQL
BEGIN
DECLARE AGE int;

select TIMESTAMPDIFF(SECOND, min(tstamp), TIMESTAMP(now())) as age
  FROM submissionsnew; 

insert into submissions (path, acceptancedatetime, json) 
  values (NEWPATH, NEWADT, NEWSUBMISSION)
  on duplicate key update json = NEWSUBMISSION;
  
insert into submissionsnew (path, acceptancedatetime) 
  values (NEWPATH, NEWADT)
  on duplicate key update acceptancedatetime = NEWADT;
  


END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `submissionsGetClearNew`()
    NO SQL
BEGIN

START TRANSACTION;
	SELECT sn.path, sn.acceptancedatetime, s.json 
      FROM submissionsnew sn inner join submissions s on s.path=sn.path
      ORDER BY sn.acceptancedatetime;
      
    TRUNCATE submissionsnew;
COMMIT;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `truncQuarterly`()
    NO SQL
BEGIN
    TRUNCATE eventlog;
    TRUNCATE exemptOffering;
    TRUNCATE exemptOfferingIssuers;
    TRUNCATE exemptOfferingPersons;
    TRUNCATE fin_num;
    TRUNCATE fin_sub;
    TRUNCATE ownership_footnote_2016q1;
    TRUNCATE ownership_reporter_2016q1;
    TRUNCATE ownership_submission_2016q1;
    TRUNCATE ownership_transaction_2016q1;
    TRUNCATE ownership_transaction_footnote_2016q1;
    TRUNCATE submissions;
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `truncOwner`()
    NO SQL
BEGIN

truncate table eventlog;
truncate table ownership_reporter;
truncate table ownership_submission;
truncate table ownership_transaction_footnote;
truncate table ownership_footnote;
truncate table ownership_transaction;

/*call dropIndexSafely('ownership_reporter','ownercik'); 
call dropIndexSafely('ownership_submission','adsh'); 
call dropIndexSafely('ownership_submission','issuercik'); 

ALTER TABLE `ownership_reporter`
  ADD PRIMARY KEY (`adsh`,`ownernum`),
  ADD KEY `ownercik` (`ownercik`);
ALTER TABLE `ownership_submission`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `adsh` (`adsh`),
  ADD KEY `issuercik` (`issuercik`);
*/

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `truncateData`()
    NO SQL
BEGIN

truncate table datasets;
truncate table eventlog;
truncate table f_sub;
truncate table f_tag;
truncate table f_num;
truncate table f_pre;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `truncateAnalytics`()
    NO SQL
BEGIN

  truncate table standardtag;
  truncate table facts;
  truncate table timeseries;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateEdgarNames`()
    NO SQL
BEGIN

DROP TABLE IF EXISTS names_tmp ;
CREATE TABLE names_tmp (
  adsh varchar(20) CHARACTER SET latin1 COLLATE latin1_general_cs NOT NULL,
  cik varchar(20) CHARACTER SET latin1 COLLATE latin1_general_cs NOT NULL,
  name_ci varchar(512) COLLATE latin1_general_ci DEFAULT NULL COMMENT 'case insensitive for search index',
  lastname_soundex varchar(512) COLLATE latin1_general_ci NOT NULL COMMENT 'soundex of last name (= first word of name)'
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci;

ALTER TABLE names_tmp 
  ADD PRIMARY KEY (adsh,cik,name_ci);  -- need before inserts to avoid case insensitive dups

#warning: escaped regex on save: \\. becomes \. becomes .
INSERT into names_tmp 
  SELECT 
    '',
    ownercik, 
    TRIM(REGEXP_REPLACE(concat(' ', ownername, ' '), '.|,| phd| md','')),
    soundex(SUBSTRING(trim(ownername),1,instr(trim(ownername), ' ')-1))
  from ownership_reporter
  ON DUPLICATE KEY UPDATE names_tmp.cik=ownership_reporter.ownercik;

INSERT into names_tmp 
  select adsh, 0, concat(lastName,' ',firstName,' ', coalesce(MiddleName,'')), soundex(lastName) 
  from exemptOfferingPersons
  ON DUPLICATE KEY UPDATE names_tmp.adsh=exemptOfferingPersons.adsh;

-- add Full text indexes 
ALTER TABLE names_tmp ADD FULLTEXT KEY name_ci (name_ci);
ALTER TABLE names_tmp ADD FULLTEXT KEY lastname_soundex (lastname_soundex);

START TRANSACTION;
  DROP TABLE IF EXISTS edgar_names;
  RENAME TABLE names_tmp to edgar_names;
COMMIT;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `truncateCrawlerData`()
    NO SQL
BEGIN

truncate table fin_sub;
truncate table fin_tag;
truncate table fin_num;
truncate table fin_pre;
truncate table eventlog;
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateFrame`(IN `TAG` VARCHAR(255), IN `UOM` VARCHAR(60), IN `CCP` VARCHAR(9), IN `QTRS` SMALLINT, IN `FRAMEJSON` MEDIUMTEXT, IN `TSTAMP` TIMESTAMP)
    NO SQL
BEGIN
DECLARE FRAMEEXISTS INT;
DECLARE STANDARDLABEL VARCHAR(512) DEFAULT null;
DECLARE STANDARDDESCRIPTION VARCHAR(2048) DEFAULT null;

IF char_length(FRAMEJSON) = 0 THEN  
    #initial request
	select count(*) into FRAMEEXISTS 
    from frames f 
    where f.tag=TAG and f.uom=UOM and f.ccp=CCP
    group by f.tag, f.uom, f.ccp;
 	IF FRAMEEXISTS=1 THEN #frame exists
    	select * from frames f where f.tag=TAG and f.uom=UOM and f.ccp=CCP;
    ELSE  #frame DNE; create and then return skeleton frame
    	SELECT label, description into STANDARDLABEL, STANDARDDESCRIPTION 
          from standardtag st where st.tag=TAG;
    	INSERT into frames (tag, uom, ccp, qtrs, label, description, json, pts, tstamp) 
          VALUES (TAG, UOM, CCP, QTRS, coalesce(STANDARDLABEL, TAG), STANDARDDESCRIPTION, '[]', 0, now());
    	select * from frames f where f.tag=TAG and f.uom=UOM and f.ccp=CCP;
    END IF;
ELSE  #update request
	select count(*) into FRAMEEXISTS from frames f
    where f.tag=TAG and f.uom=UOM and f.ccp=CCP and f.tstamp = TSTAMP
    group by f.tag, f.uom, f.ccp;
    
    IF FRAMEEXISTS=1 THEN
    	update frames f 
          set f.json=FRAMEJSON, f.tstamp=CURRENT_TIMESTAMP 
          where f.tag=TAG and f.uom=UOM and f.ccp=CCP;
        select 1 as processed;
    ELSE #collision!
        select * from frames f where f.tag=TAG and f.uom=UOM and f.ccp=CCP;
    END IF;
END IF;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateFrames2`(IN `new_adsh` VARCHAR(20))
    NO SQL
BEGIN
    #assumes new_adsh is the latest submission = greatly simplifies
    #do not call this routine if reprocessing historical submissions or call makeFrame() after to fix tables

    #4ms to run newFrame query (455 rows for '0001018003-16-000071'
    CREATE TEMPORARY TABLE newPoints
        SELECT
            distinct s.adsh, s.cik, n.tag, n.ccp, n.qtrs, n.uom, st.label as label, st.description,
            CONCAT('{"accn":"', s.adsh, '","cik":', s.cik, ',"entityName":"', jclean(s.name),'","sic":', coalesce(s.sic,'NULL'), ',"loc":"',
              COALESCE(s.countryba, s.countryma,''),'-', COALESCE(s.stprba, s.stprma,''),'"',coalesce(concat(',"start":"',n.startdate,'"'),
              ''),',"end":"', n.enddate, '","val":', n.value, '}') as pointjson
        FROM f_num n inner join f_sub s on n.adsh=s.adsh
               INNER JOIN standardtag st ON n.tag = st.tag
        WHERE s.adsh=new_adsh AND n.ccp is not null;


set @@session.group_concat_max_len = 1048576 * 10;
set @@global.max_allowed_packet = 1048576 * 10;

    #(A) XXms to update existing frame where CIK is represented
    update frames f, newPoints np
        set f.json = REGEXP_REPLACE(json, '{[^}]+,"cik":1018003,[^}]+}', np.pointjson)
    where f.tag=np.tag and f.ccp=np.ccp and f.uom=np.uom and f.json like concat('%,"cik":',np.cik,',%');

    #(B) XXms to update existing frame where CIK is NOT represented
    update frames f, newPoints np
    set f.json = concat('[', np.pointjson, ',', substring(json from 2)), pts=pts+1
    where f.tag=np.tag and f.ccp=np.ccp and f.uom=np.uom and f.json not like concat('%,"cik":',np.cik,',%');

    #(C) XXms to insert new frame where frame DNE
    insert into frames (tag, ccp, uom, qtrs, label, description, pts, json, tstamp)
    select tag, ccp, uom, qtrs, label, description, 1, concat('[',pointjson,']'), now() from newPoints
        on duplicate key update tstamp=now();
        
    select f.* from frames f, newPoints np where f.tag=np.tag and f.ccp=np.ccp and f.uom=np.uom;     

    drop temporary table newPoints;


  END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateFrames`(IN `ADSH` VARCHAR(20))
    NO SQL
BEGIN
#creates 154 records in 7.2s  <- revlalidate!

CREATE TEMPORARY TABLE newFrame 
  SELECT
  distinct n.tag, n.ccp, n.qtrs, n.uom, st.label as label, st.description
  FROM f_num n
  INNER JOIN standardtag st ON n.tag = st.tag
 WHERE n.ccp is not null AND n.adsh=ADSH;

#insert into frames (tag, ccp, uom, qtrs, label, description, pts, json, api_written) 
select fr.tag, fr.ccp, fr.uom, fr.qtrs, fr.label, fr.description,  count(*) as pts, 
  CONCAT('[', GROUP_CONCAT(CONCAT('{"accn":"', s.adsh, '","cik":', s.cik, ',"entityName":"', s.name,'","sic":', s.sic, 
     ',"loc":"', COALESCE(s.countryba, s.countryma,''),'-', COALESCE(s.stprba, s.stprma,''),'","start":', 
     coalesce(concat('"',n.startdate,'"'),'null'),',"end":"', n.enddate,'","val":', n.value, ',"rev":', s.filed, '}') order by s.cik, s.filed), ']') as json,  0
from newFrame fr
inner join f_num n force index for join (tagccpuom) ON fr.tag=n.tag and fr.ccp=n.ccp and fr.uom=n.uom
INNER JOIN f_sub s on n.adsh = s.adsh
inner join (
    select nf.tag, nf.ccp, nf.uom, cik, max(filed) as maxfiled, count(distinct value) as versions
    from newFrame nf
    inner join f_num n USE INDEX (tagccpuom, ix_adshtag) ON nf.tag=n.tag and nf.ccp=n.ccp AND nf.uom=n.uom 
    inner join f_sub s on s.adsh=n.adsh
    group by n.tag, n.ccp, n.uom, s.cik
) mx on mx.tag=n.tag and mx.ccp=n.ccp and mx.uom=n.uom and mx.cik=s.cik and s.filed=mx.maxfiled
GROUP BY fr.tag, fr.ccp, fr.uom, fr.label
#on duplicate key update label=fr.label, description=fr.description, pts=pts, json=json, api_written=0
;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateOwnershipAPI`(IN `ADSH` VARCHAR(25))
    NO SQL
BEGIN
#executes in 5 minutes (Python writer to S3 another 30 minutes for 175K objects)
DECLARE ISSUERCIK varchar(25);
SET SESSION group_concat_max_len = 16000000; # 16MB
SET GLOBAL max_allowed_packet = 16000000; # 16MB

#ISSUERS
select s.issuercik into ISSUERCIK from ownership_submission s where s.adsh=ADSH; 
#delete from ownership_api_issuer where cik=ISSUERCIK;
REPLACE into ownership_api_issuer (cik, transactions, lastfiledt)
select STRAIGHT_JOIN s.issuercik, #select executes in 32 ms with FORCE PRIMARY
	concat(
      '[["',
      GROUP_CONCAT(
         concat_ws(
           '","',s.form, s.adsh, t.transnum,
           coalesce(t.transcode, ''),
           coalesce(t.acquiredisposed, ''),
           coalesce(t.directindirect, ''),
           coalesce(t.transdt,''),
           concat(substring(filedt,1,4),'-',substring(filedt,5,2),'-',substring(filedt,7,2)),
           jclean(r.ownername), 
           r.ownercik, 
           coalesce(t.shares,''),
           coalesce(t.sharesownedafter, ''),
           jclean(t.security)
         ) ORDER BY coalesce(t.transdt, s.filedt) desc SEPARATOR '"],["'
      ),
      '"]]'
    ) as transactjson,
    max(s.filedt) as maxfiledt
from ownership_submission s FORCE INDEX (adsh, issuercik)
  INNER JOIN ownership_reporter r FORCE INDEX for JOIN (PRIMARY) on s.adsh = r.adsh
  INNER JOIN ownership_transaction t FORCE INDEX for JOIN (PRIMARY) on s.adsh = t.adsh
where r.ownernum = 1 and t.transtype='T' and s.issuercik=ISSUERCIK
group by s.issuercik;

Update ownership_api_issuer a,  #executes in 300ms
  (select max(filed) as lastfiledt, cik from f_sub group by cik having cik=ISSUERCIK) s
  set a.lastfiledt = s.lastfiledt
  WHERE a.cik=s.cik and a.cik=ISSUERCIK;
  
Update ownership_api_issuer a, f_sub s  #executes in 12 ms
  set a.name = s.name,
    a.mastreet1 =  s.mas1,
    a.mastreet2 =  s.mas2,
    a.macity = s.cityma,
    a.mastate = s.stprma,
    a.mazip =  s.zipma,                           
    a.bastreet1 = s.bas1,
    a.bastreet2 = s.bas2,
    a.bacity = s.cityba,
    a.bastate = s.stprba, 
    a.bazip = s.zipba
  WHERE a.cik=s.cik and a.lastfiledt = s.filed and s.cik=ISSUERCIK;  


#REPORTERS
#delete from ownership_api_reporter where cik in (select r.ownercik from ownership_reporter r where r.adsh = adsh); # 7ms
REPLACE into ownership_api_reporter (cik, transactions, lastfiledt) #executes in 100 ms
select r.ownercik,
	concat('[["',
       GROUP_CONCAT(
         concat_ws(
           '","',s.form, s.adsh, t.transnum,
           coalesce(t.transcode, ''),
           coalesce(t.acquiredisposed, ''),
           coalesce(t.directindirect, ''),
           coalesce(t.transdt,''),
           concat(substring(filedt,1,4),'-',substring(filedt,5,2),'-',substring(filedt,7,2)),
           jclean(s.issuername), 
           s.issuercik, 
           coalesce(t.shares,''),
           coalesce(t.sharesownedafter, ''),
           jclean(t.security)
         ) ORDER BY coalesce(t.transdt, s.filedt) desc SEPARATOR '"],["'
       ),
       '"]]'
    ),
    max(s.filedt)
from ownership_submission s
  INNER JOIN ownership_reporter r on r.adsh = s.adsh
  INNER JOIN ownership_transaction t on t.adsh = s.adsh
  INNER JOIN ownership_reporter r2 on r.ownercik=r2.ownercik
where r2.adsh=ADSH
group by r.ownercik;

Update ownership_api_reporter a, #executes in 9ms
 ownership_reporter r
set a.name = r.ownername,
  a.mastreet1=r.ownerstreet1,
  a.mastreet2=r.ownerstreet2,
  a.macity=r.ownercity,
  a.mastate=r.ownerstate,
  a.mazip=r.ownerzip                       
  WHERE a.cik=r.ownercik and r.adsh=ADSH;

select s.issuercik, r.ownercik from ownership_submission s inner join ownership_reporter r on s.adsh=r.adsh where s.adsh = ADSH;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `addFilingIndexes`()
    NO SQL
BEGIN

#assumes PKs and indexes have been dropped
#replaced with autonum ID:  ALTER TABLE f_num ADD PRIMARY KEY (adsh, tag, version, ddate, qtrs, uom, coreg);
ALTER TABLE f_tag ADD PRIMARY KEY (tag, version);
ALTER TABLE f_sub ADD PRIMARY KEY (adsh);
ALTER TABLE f_pre ADD PRIMARY KEY (adsh, report, line);

#indexes
CREATE INDEX ix_subcik ON f_sub (cik); 
CREATE INDEX ix_adshtag ON f_num (adsh, tag);
CREATE INDEX ix_tagddateqtrs ON f_num (tag, ddate, qtrs);

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateTimeSeries`(IN `ADSH` VARCHAR(25))
    NO SQL
BEGIN
#execution time = 70ms for adsh = '0000002178-18-000067' returning 94 timeseries
DECLARE CIK INT;
DECLARE SIC INT;
DECLARE ENTITYNAME varchar(200);
    
  #1. get CIK and name of entity for this ADSH 
  select s.cik, s.name, s.sic into CIK, ENTITYNAME, SIC from fin_sub s where s.adsh = ADSH; 
  
  #2. create a tmp table of the standard tags updated in this submission
  CREATE TEMPORARY TABLE IF NOT EXISTS tmp_standard_tags_with_new_facts AS 
  (  select distinct n.tag, st.label, st.description, n.uom, n.qtrs
     from fin_num n 
     INNER JOIN standardtag st on st.tag = n.tag   
     where n.adsh = ADSH and n.ccp is not null
  );
  
  #3. make TS and insert into tmp_timeseries 
  CREATE TEMPORARY TABLE IF NOT EXISTS tmp_timeseries 
  (
    Select @CIK, 
      nf.tag,
      nf.label,
      nf.description,
      nf.uom, 
      nf.qtrs, 
      COUNT(distinct n.enddate) as pts, 
    CONCAT("[",  GROUP_CONCAT(CONCAT('{"start":', coalesce(concat('"',n.startdate,'"'),'null'), ',"end":"', enddate, '","val":', value, ',"accn":"', s.adsh, '","fy":', s.fy, ',"fp":"', s.fp, '","form":"', s.form, '"}') ORDER BY enddate ASC, s.adsh DESC SEPARATOR ","), "]") as json
    from tmp_standard_tags_with_new_facts nf
    inner join fin_num n on n.tag=nf.tag and n.uom=nf.uom and n.qtrs=nf.qtrs
    inner join fin_sub s on n.adsh=s.adsh
    where n.ccp is not null and s.cik = CIK
    group by nf.tag, nf.uom, nf.qtrs
  );


  #4. insert / update timeseries table 
  INSERT INTO timeseries (cik, entityName, tag, label, description, uom, qtrs, pts, json) 
    Select cik, ENTITYNAME, tag, label, description, uom, qtrs, pts, json
    from tmp_timeseries
  ON DUPLICATE KEY UPDATE
    timeseries.entityName = ENTITYNAME,
    timeseries.label = tmp_timeseries.label,
    timeseries.description = tmp_timeseries.description,
  	timeseries.pts = tmp_timeseries.pts,
  	timeseries.json = tmp_timeseries.json;

  #6. set submission state to intermediate; lambda code will change state to final after succesfully writing REST API files to S3 
  #update fin_sub s SET s.processedState = 2 
  #  where s.cik=CIK and s.processedState = 1; 
   
  #7. return timeseries for @CIK's updated tags (not restricted by uom or qtrs) to write out bundles timeseries to S3
  select DISTINCTROW ts.*
  from timeseries ts 
  inner JOIN tmp_standard_tags_with_new_facts nf on ts.tag=nf.tag
  where ts.cik=CIK
  order by ts.cik, ts.tag, ts.uom, ts.qtrs;
  
  #8. drop tmp tables
  DROP TEMPORARY TABLE IF EXISTS tmp_standard_tags_with_new_facts;
  DROP TEMPORARY TABLE IF EXISTS tmp_timeseries;
    
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `efts_update_ranks`()
    NO SQL
BEGIN
	DECLARE archivesLengthInDays bigint DEFAULT DATEDIFF(now(),STR_TO_DATE('1/1/1994', '%m/%d/%Y'));
  
  	update efts_entities e, 
    	(SELECT  
       		er.cik, 
       		sum(f.length_indexed * (1-DATEDIFF(now(), s.filedt)/archivesLengthInDays)) as rank
    	FROM efts_entities er 
      		INNER JOIN efts_submissions_entities se ON er.cik=se.cik 
      		INNER JOIN efts_submissions s ON se.adsh=s.adsh
      		INNER JOIN efts_submissions_files f ON se.adsh=f.adsh
    	GROUP BY er.cik) as ranks
    	set e.rank = cast(ranks.rank as INTEGER)
    	where e.cik = ranks.cik;
 
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `dropFilingIndexes`()
    SQL SECURITY INVOKER
BEGIN

#autonum PK can't be dropped.  was:  ALTER TABLE f_num DROP PRIMARY KEY;
ALTER TABLE f_tag DROP PRIMARY KEY;
ALTER TABLE f_sub DROP PRIMARY KEY; 
ALTER TABLE f_pre DROP PRIMARY KEY;


call dropIndexSafely('f_num','ix_adshtag');
call dropIndexSafely('f_num','ix_tagddateqtrs');
call dropIndexSafely('f_sub','ix_subcik');



END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `dropIndexSafely`(IN `tbl` VARCHAR(255), IN `ix` VARCHAR(255))
    NO SQL
BEGIN

IF((SELECT COUNT(*) AS index_exists 
    FROM information_schema.statistics 
    WHERE TABLE_SCHEMA = DATABASE() 
      and table_name =tbl 
      AND index_name = ix) > 0) 
THEN
   SET @s = CONCAT('DROP INDEX ' , ix , ' ON ' , tbl);
   PREPARE stmt FROM @s;
   EXECUTE stmt;
 END IF;
 
 END$$
DELIMITER ;
