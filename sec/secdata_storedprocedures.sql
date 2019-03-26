DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeFacts`()
    NO SQL
BEGIN
#create 700k records in 1h (250k of which were single pnt facts)
#variable declarations
DECLARE currentTag varchar(255);
DECLARE currentTlabel varchar(512);
DECLARE currentDoc varchar(2048);
DECLARE terminate INT DEFAULT 0;
DECLARE i INT DEFAULT 0;

#cursor declarations
DECLARE cr_standardTags CURSOR FOR 
  SELECT tag, tlabel, doc 
  FROM standardtag st
  ; #WHERE tag = 'NetIncomeLoss';  #testing muzzle = remove to build!
DECLARE CONTINUE HANDLER FOR NOT FOUND SET terminate = 1;

TRUNCATE TABLE facts;

#double the max size to 2 MB for group_concat and concat
set @@session.group_concat_max_len = 1048576 * 2;
set @@global.max_allowed_packet = 1048576 * 2;

Open cr_standardTags;
st_loop: LOOP
  FETCH cr_standardTags INTO currentTag, currentTlabel, currentDoc;
  IF terminate = 1 THEN
    LEAVE st_loop;
  END IF;

  ddates: BEGIN
    DECLARE currentDdate char(10);
    DECLARE currentQtr tinyint;
    DECLARE done_inner INT DEFAULT 0;
    DECLARE cr_ddates CURSOR FOR 
      SELECT DISTINCT ddate, qtrs 
      from f_num n 
      WHERE qtrs in (0,1,4) and coreg='' and tag = currentTag;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done_inner = 1;
    
	Open cr_ddates;
	ddate_loop: LOOP
      FETCH cr_ddates INTO currentDdate, currentQtr;
      IF done_inner = 1 THEN
        LEAVE ddate_loop;
      END IF;
      
    #create the facts fro this tag, ddate!
    INSERT INTO facts (tag, ddate, uom, qtrs, tlabel, tdoc, pts, json)
       SELECT n.tag, n.ddate, n.uom, n.qtrs, currentTlabel, currentDoc,
         count(*),
         CONCAT('[', GROUP_CONCAT(CONCAT('["', s.adsh, '",', s.cik, ',', s.sic, ',"', s.name, '","', s.countryba, '",', COALESCE(concat('[', pl.lat, ',', pl.lon, ']'), 'null'), ',', n.value, ',', revisions, ']')), ']')
       FROM f_num n 
         INNER JOIN f_sub s ON n.adsh = s.adsh 
         INNER JOIN 
         (
           SELECT max(s.fy+(pr.rank/10)) as maxrank, s.cik, n.tag, n.ddate, n.uom, n.qtrs, count(DISTINCT n.value) as revisions
           FROM f_num n 
             INNER JOIN f_sub s on n.adsh = s.adsh
             INNER JOIN standardtag st on n.tag = st.tag
             INNER JOIN fp_ranks pr on s.fp=pr.fp
           WHERE n.tag=currentTag AND n.qtrs=currentQtr 
             AND n.ddate=currentDdate 
             AND n.coreg='' AND n.value is not null
           GROUP BY n.tag, n.ddate, n.uom, n.qtrs, s.cik
         ) mx 
          ON n.tag=mx.tag AND n.ddate=mx.ddate AND n.uom=mx.uom AND n.qtrs=mx.qtrs AND mx.cik=s.cik
         INNER JOIN fp_ranks pr on s.fp=pr.fp
         LEFT OUTER JOIN postcodeloc pl on s.countryba = pl.cnty and left(s.zipba, 5) = pl.zip  
       WHERE n.tag=currentTag AND n.qtrs=currentQtr AND n.ddate=currentDdate
         AND s.fy+(pr.rank/10) = mx.maxrank AND mx.cik=s.cik
         AND n.coreg='' AND n.value is not null
       GROUP BY n.uom;
    END LOOP ddate_loop;
    CLOSE cr_ddates;
  END ddates;


END LOOP st_loop;

#release resources and cleanup
CLOSE cr_standardTags;


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
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeStandardTags`()
    NO SQL
BEGIN
  DROP TABLE IF EXISTS standardtag;
  
  CREATE TABLE standardtag (
    tag varchar(255)  PRIMARY KEY,
    maxversion varchar(50),
    tlabel  varchar(512) NULL,
    doc  varchar(2048) NULL,
    cnt int DEFAULT 0
  );
  INSERT INTO standardtag (tag, maxversion) 
     SELECT tag, version from f_tag 
     WHERE custom=0
     ON duplicate key update maxversion = if(maxversion<version, version, maxversion);
  UPDATE standardtag st, f_tag t
    SET st.tlabel = t.tlabel, st.doc = t.doc
    WHERE st.tag = t.tag and st.maxversion = t.version;

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
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeFrames`()
    NO SQL
BEGIN
#creates 720k records in 42min (250k of which were single pnt frame)
#variable declarations
DECLARE currentTag varchar(255);
DECLARE currentTlabel varchar(512);
DECLARE currentDoc varchar(2048);
DECLARE terminate INT DEFAULT 0;
DECLARE i INT DEFAULT 0;

#cursor declarations
DECLARE cr_standardTags CURSOR FOR 
  SELECT tag, tlabel, doc 
  FROM standardtag st
  ; #WHERE tag = 'NetIncomeLoss';  #testing muzzle = remove to build!
DECLARE CONTINUE HANDLER FOR NOT FOUND SET terminate = 1;

TRUNCATE TABLE frames;

#double the max size to 2 MB for group_concat and concat
set @@session.group_concat_max_len = 1048576 * 2;
set @@global.max_allowed_packet = 1048576 * 2;

Open cr_standardTags;
st_loop: LOOP
  FETCH cr_standardTags INTO currentTag, currentTlabel, currentDoc;
  IF terminate = 1 THEN
    LEAVE st_loop;
  END IF;

  ddates: BEGIN
    DECLARE currentDdate char(10);
    DECLARE currentQtr tinyint;
    DECLARE currentUom varchar(20);
    DECLARE done_inner INT DEFAULT 0;
    DECLARE cr_ddates CURSOR FOR 
      SELECT DISTINCT ddate, qtrs, uom 
      from f_num n
      WHERE qtrs in (0,1,4) and coreg='' AND n.value is not null
        and adsh <> version and tag = currentTag;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done_inner = 1;
    
	OPEN cr_ddates;
	ddate_loop: LOOP
      FETCH cr_ddates INTO currentDdate, currentQtr, currentUom;
      IF done_inner = 1 THEN
        LEAVE ddate_loop;
      END IF;
     
    # regular table = not thread safe for multiple simultaneous procedures
    # note: can't include company info (name, zip) in case of change
    TRUNCATE TABLE frame_working;
    INSERT INTO frame_working  (cik, adsh, name, sic, rank, filed, country, zip, value) 
      SELECT s.cik, s.adsh, s.name, s.sic, s.fy+COALESCE(fr.rank,1)/10,
        s.filed, s.countryba, LEFT(s.zipba, 5), value
      FROM f_num n 
        INNER JOIN f_sub s ON n.adsh = s.adsh
        LEFT OUTER JOIN fp_ranks fr ON s.fp=fr.fp
      WHERE n.tag=currentTag AND n.qtrs=currentQtr
        AND n.ddate=currentDdate AND n.uom=currentUom
        AND n.coreg='' AND n.value is not null
        AND n.adsh <> n.version
      GROUP BY s.cik, s.adsh, value;
      

    #create the frames for this tag, ddate, uom!
    INSERT INTO frames (tag, ddate, uom, qtrs, tlabel, tdoc, pts, json)
       SELECT currentTag, currentDdate, currentUom, currentQtr,
         currentTlabel, currentDoc, COUNT(*),
         CONCAT('[', GROUP_CONCAT(CONCAT('["', fw.adsh, '",', fw.cik, ',', fw.sic, ',"', fw.name, '","', fw.country, '",', COALESCE(concat('[', pl.lat, ',', pl.lon, ']'), 'null'), ',', fw.value, ',', revisions, ']')), ']')
       FROM frame_working fw
       INNER JOIN  (
             SELECT cik,
             MAX(filed) as lastfiled,
             COUNT(DISTINCT value) AS revisions
             FROM frame_working 
             GROUP BY cik
         ) mxfiled ON fw.cik=mxfiled.cik and lastfiled=fw.filed 
       INNER JOIN (
             SELECT cik, filed, MAX(rank) as maxrank
             FROM frame_working fw 
             GROUP BY cik, filed
         ) mxrank ON mxrank.cik=fw.cik AND fw.filed=mxrank.filed
         	AND fw.rank=mxrank.maxrank
       LEFT OUTER JOIN postcodeloc pl ON fw.country= pl.cnty 
           AND fw.zip=pl.zip;
    END LOOP ddate_loop;
    CLOSE cr_ddates;
  END ddates;


END LOOP st_loop;

#release resources and cleanup
CLOSE cr_standardTags;


END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeTimeSeries`(IN `start_cik` INT)
    NO SQL
BEGIN
#added index, created 3.8M times series & drop index in 28m
DECLARE currentCik INT;
#DECLARE currentCoName VARCHAR(150);
DECLARE terminate INTEGER DEFAULT 0;
DECLARE ciks CURSOR FOR
  SELECT DISTINCT cik FROM f_sub where cik>= start_cik;
DECLARE CONTINUE HANDLER 
        FOR NOT FOUND SET terminate = 1;


CREATE TEMPORARY TABLE tmp_adsh select adsh, name, sic, fy, fp, form from f_sub limit 0;
 
if(start_cik=0) 
  then truncate table timeseries;
end if;

Open ciks;
cik_loop: LOOP

  FETCH ciks INTO currentCik;
  IF terminate = 1 THEN
    LEAVE cik_loop;
  END IF;
 
  #create a tmp table of just the adsh for this cik (b/c mysql is incompetent at optimizing this query)
  TRUNCATE TABLE tmp_adsh;
  insert into tmp_adsh  select adsh, name, sic, fy, fp, form from f_sub where cik = currentCik;
 
  #insert the cik’s f_num records into temp table
  CREATE TEMPORARY TABLE standard_pts 
    SELECT n.adsh, n.tag, n.uom, n.qtrs, n.value, n.ddate, name, sic, fy, fp, form
    FROM f_num n inner join tmp_adsh ta on n.adsh=ta.adsh
    WHERE n.version <> n.adsh and coreg="" and qtrs in (0,1,4);

  INSERT INTO timeseries (cik, tag, uom, qtrs, pts, json) 
    Select currentCik, tag, uom, qtrs, COUNT(distinct ddate), CONCAT("[",  GROUP_CONCAT(CONCAT("[""", ddate, """,", value, ",""", adsh, """,""", fy, " ", fp, """,""", form, """,""", replace(name, "'", "''"), """,", sic, "]") ORDER BY ddate ASC, ADSH DESC SEPARATOR ","), "]") from standard_pts group by tag, uom, qtrs;

  DROP TEMPORARY TABLE IF EXISTS standard_pts;

END LOOP cik_loop;

#release resources
CLOSE ciks;
DROP TEMPORARY TABLE IF EXISTS tmp_adsh;

#final update of timeseries’ co name, tag name, and tag description from f-tag and f_sub

#get latest definition of all standard tag into temp table
UPDATE standardtag st, timeseries ts
set ts.tlabel=st.tlabel, ts.doc=st.doc
where ts.tag=st.tag;

#get latest company name too
update timeseries ts 
  inner join f_sub s on ts.cik = s.cik 
  inner join (select max(period) as period, cik from f_sub group by cik) mxs on mxs.cik = s.cik and mxs.period = s.period 
set ts.coname = s.name;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `makeOwnershipAPI`()
    NO SQL
BEGIN
#executes in 5 minutes (Python writer to S3 another 30 minutes for 175K objects)

TRUNCATE ownership_api_reporter;
TRUNCATE ownership_api_issuer;

SET SESSION group_concat_max_len = 8000000; # 8MB

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
           replace(replace(r.ownername,'\\','\\\\'),'"','\\"'), 
           r.ownercik, 
           coalesce(t.shares,''),
           coalesce(t.sharesownedafter, ''),
           replace(replace(REPLACE(REPLACE(t.security, '\r', ' '), '\n', ' '),'\\','\\\\'),'"','\\"')
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
           replace(replace(s.issuername,'\\','\\\\'),'"','\\"'), 
           s.issuercik, 
           coalesce(t.shares,''),
           coalesce(t.sharesownedafter, ''),
           replace(replace(REPLACE(REPLACE(t.security, '\r', ' '), '\n', ' '),'\\','\\\\'),'"','\\"')
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
insert into matches select ownercik, GROUP_CONCAT(ownername_ci SEPARATOR ' <br><i>also filed as</i> '), 1 from ownership_names
    where ownername_ci like concat(lastname,' %') COLLATE latin1_general_ci and (
        ownername_ci rlike concat('^', lastname, exactFirst, '[a-zA-Z]*', exactMiddle) COLLATE latin1_general_ci	
    	or ownername_ci rlike concat('^', lastname, exactFirst, exactMI,'[[:>:]]') COLLATE latin1_general_ci	
    	or ownername_ci rlike concat('^', lastname, exactFI, exactMiddle,'[[:>:]]') COLLATE latin1_general_ci	
    	or ownername_ci rlike concat('^', lastname, exactFI, exactMI,'[[:>:]]') COLLATE latin1_general_ci)
        GROUP BY ownercik;
        
#exact match of last name + match of first & middle initial WITH possible contradictions
insert into matches select ownercik, ownername_ci, 2 as rank from ownership_names
    where ownername_ci like concat(lastname, likeFI, likeMI) COLLATE latin1_general_ci	
    or ownername_ci like concat(lastname, likeMI, likeFI) COLLATE latin1_general_ci
    on duplicate key update matches.cik=ownercik;  
    
   
/*#either first or middle initials match full names 
insert into matches select ownercik, ownername_ci, 3 from ownership_names
    where (ownername_ci LIKE concat(lastname, likeFI) COLLATE latin1_general_ci and hasFirst) 
    or (ownername_ci LIKE concat(lastname, likeMi) COLLATE latin1_general_ci and hasMiddle) 	
    on duplicate key update cik=ownercik; */
#soundex lastname + 

insert into matches select * from (select ownercik, GROUP_CONCAT(ownername_ci SEPARATOR ' <br><i>also files as</i> ') as ownernames, 4 from ownership_names
    where ownerlastname_soundex = soundex(lastname) COLLATE latin1_general_ci
    and ((not hasFirst) or ownername_ci RLIKE exactFI COLLATE latin1_general_ci)
   AND ((not hasMiddle) or ownername_ci RLIKE exactMI COLLATE latin1_general_ci) 
   GROUP  BY ownercik) sm
    on duplicate key update cik=ownercik; 

select * from matches;

drop temporary table matches;
  
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
CREATE DEFINER=`root`@`localhost` PROCEDURE `truncateAnalytics`()
    NO SQL
BEGIN

  truncate table standardtag;
  truncate table facts;
  truncate table timeseries;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateFrames`()
    NO SQL
BEGIN
#creates 700k records in 5h (250k of which were single pnt facts)

#variable declarations
DECLARE newTag varchar(255);
DECLARE standardTlabel varchar(512);
DECLARE standardDoc varchar(2048);
DECLARE newDdate char(10);
DECLARE newUom varchar(256);
DECLARE newQtrs tinyint;
DECLARE json text;
DECLARE pts int;
DECLARE terminate INT DEFAULT 0;

#cursor and handler declarations
DECLARE cr_newtagdates CURSOR FOR 
  SELECT distinct n.tag, ddate, qtrs, uom, st.tlabel, st.doc
  FROM f_sub s 
    inner join f_num n on s.adsh = n.adsh
    INNER JOIN standardtag st ON n.tag = st.tag
  WHERE s.api_state=3 
    AND n.version<>n.adsh 
    AND n.coreg=''
    AND n.qtrs in (0,1,4);
DECLARE CONTINUE HANDLER FOR NOT FOUND SET terminate = 1;

#double the max size to 2 MB for group_concat and concat
set @@session.group_concat_max_len = 1048576 * 2;
set @@global.max_allowed_packet = 1048576 * 2;

CREATE TEMPORARY TABLE tmp_frame_num 
  select s.adsh, s.cik, s.filed as lastfiled, n.value from f_sub s inner join f_num n on n.adsh=s.adsh limit 0;

Open cr_newtagdates;
fact_loop: LOOP
  FETCH cr_newtagdates INTO newTag, newDdate, newQtrs, newUom, 
    standardTlabel, standardDoc;
  IF terminate = 1 THEN
    LEAVE fact_loop;
  END IF;

  # regular table = not thread safe to allow multiple procedures to run
  truncate table tmp_frame_num;
  insert into frame_working  (adsh, cik, lastfiled, value) 
     SELECT s.adsh, s.cik, max(s.filed) as lastfiled, value
       FROM f_num n 
         INNER JOIN f_sub s on n.adsh = s.adsh
       WHERE n.tag=newTag AND n.qtrs=newQtrs
         AND n.ddate=newDdate AND n.uom=newUom
         AND n.coreg='' AND n.value is not null
         AND n.adsh <> n.version
       GROUP BY s.cik, s.adsh, value;
  
  #make the fact's JSON
  SELECT 
     count(*) as pts,
     CONCAT('[', GROUP_CONCAT(CONCAT('["', s.adsh, '",', s.cik, ',', s.sic, ',"', s.name, '","', s.countryba, '",', COALESCE(concat('[', pl.lat, ',', pl.lon, ']'), 'null'), ',', n.value, ',', revisions, ']')), ']') as json
  INTO json, pts
  FROM f_sub s
    INNER JOIN (
      select cik, max(adsh) as adsh, lastfiled, revisions 
      from frame_working fw
      inner join (select cik, max(filed) as mxfiled, count(distinct value) as revisions from frame_working group by cik) mx 
        on mx.cik=fw.cik and mx.mxfiled=fw.filed
    ) mxfw on s.adsh=mxfw.adsh
    INNER JOIN frame_working fw on mxfw.adsh=fs.adsh
    LEFT OUTER JOIN postcodeloc pl on s.countryba = pl.cnty and left(s.zipba, 5) = pl.zip;
  
  INSERT INTO frames 
    (tag, ddate, uom, qtrs, tlabel, tdoc, pts, json, api_written)
    VALUES (newTag, newDdate, newUom, newQtrs, currentTlabel, currentDoc, pts, json, 0)
  ON DUPLICATE KEY UPDATE
    json=json, pts=pts, tlabel=currentTlabel, doc=currentDoc, api_written=0;
  
  truncate table tmp_frame_num;
  
END LOOP fact_loop;

#update submission's state (Note: not thread safe)
UPDATE f_sub set api_state=0 WHERE api_state=3; 
#cleanup and exit
CLOSE cr_newtagdates;
END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateOwnershipNames`()
    NO SQL
BEGIN

DROP TABLE IF EXISTS ownership_names_tmp ;
CREATE TABLE ownership_names_tmp (
  ownercik varchar(20) CHARACTER SET latin1 COLLATE latin1_general_cs NOT NULL,
  ownername_ci varchar(512) COLLATE latin1_general_ci DEFAULT NULL COMMENT 'case insensitive for search index',
  ownerlastname_soundex varchar(512) COLLATE latin1_general_ci NOT NULL COMMENT 'soundex of last name = first word of name'
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci;

ALTER TABLE ownership_names_tmp 
  ADD PRIMARY KEY (ownercik,ownername_ci);  -- need before inserts to avoid case insensitive dups

#warning: escaped regex on save: \\. becomes \. becomes .
INSERT into ownership_names_tmp 
  SELECT 
    ownercik, 
    TRIM(REGEXP_REPLACE(concat(' ', ownername, ' '), '\\.|,| phd| md','')),
    soundex(SUBSTRING(trim(ownername),1,instr(trim(ownername), ' ')-1))
  from ownership_reporter
  ON DUPLICATE KEY UPDATE ownership_names_tmp.ownercik=ownership_reporter.ownercik;

-- add Full text indexes 
ALTER TABLE ownership_names_tmp ADD FULLTEXT KEY ownername_ci (ownername_ci);
ALTER TABLE ownership_names_tmp ADD FULLTEXT KEY ownerlastname_soundex (ownerlastname_soundex);

START TRANSACTION;
  DROP TABLE IF EXISTS ownership_names;
  RENAME TABLE ownership_names_tmp to ownership_names;
COMMIT;

END$$
DELIMITER ;

DELIMITER $$
CREATE DEFINER=`root`@`localhost` PROCEDURE `updateTimeSeries`(IN `updatesOnly` BIT)
    NO SQL
BEGIN
#added analytical index (moved to addFilingIndexes), created 3.8M times series & drop index (moved to addFilingIndexes) in 28m
DECLARE currentCik INT;
#DECLARE currentCoName VARCHAR(150);
DECLARE terminate INTEGER DEFAULT 0;
DECLARE ciks CURSOR FOR
  SELECT DISTINCT cik FROM f_sub 
  where api_state=1 or not updatesOnly;  #unprocessed has multiple state
DECLARE CONTINUE HANDLER 
        FOR NOT FOUND SET terminate = 1;

CREATE TEMPORARY TABLE tmp_adsh 
  select adsh, name, sic, fy, fp, form, api_state 
  from f_sub limit 0;
 
CREATE TEMPORARY TABLE tmp_timeseries
    Select cik, tag, uom, qtrs, pts, json, newpoints
    from timeseries limit 0;
    
if(NOT updatesOnly) 
  then truncate table timeseries;
end if;

Open ciks;
cik_loop: LOOP

  FETCH ciks INTO currentCik;
  IF terminate = 1 THEN
    LEAVE cik_loop;
  END IF;
  
  #set submission state = TS step 1 processing 
  update f_sub s SET s.processedState = 2 
    where s.cik=currentcik and s.processedState = 1; 
  
  #create a tmp table of just the adsh for this cik (b/c mysql is incompetent at optimizing this query)
  TRUNCATE TABLE tmp_adsh;
  insert into tmp_adsh  
    select adsh, name, sic, fy, fp, form, api_state 
    from f_sub where cik = currentCik;
 
  #insert the current cik’s f_num records into temp table
  CREATE TEMPORARY TABLE standard_pts 
    SELECT n.adsh, n.tag, n.uom, n.qtrs, n.value, n.ddate, name, sic, fy, fp, form
    FROM f_num n inner join tmp_adsh ta on n.adsh=ta.adsh
    WHERE n.version <> n.adsh and coreg="" and qtrs in (0,1,4);

  #insert the cik’s timeseries records into temp table
  truncate tmp_timeseries;
  INSERT INTO tmp_timeseries
    Select currentCik, 
      tag, 
      uom, 
      qtrs, 
      COUNT(distinct ddate) as pts, 
    CONCAT("[",  GROUP_CONCAT(CONCAT("[""", ddate, """,", value, ",""", adsh, """,""", fy, " ", fp, """,""", form, """,""", replace(name, "'", "''"), """,", sic, "]") ORDER BY ddate ASC, ADSH DESC SEPARATOR ","), "]") as json, 
      sum(if(api_state=2, 1, 0)) as newpoints
    from standard_pts 
    group by tag, uom, qtrs;

  #inpute/update 
  INSERT INTO timeseries (cik, tag, uom, qtrs, pts, json, newpoints) 
    Select cik, tag, uom, qtrs, pts, json, newpoints
    from tmp_timeseries
    where newpoints>0 or not updatesOnly
  ON DUPLICATE KEY UPDATE
  	timeseries.pts = tmp_timeseries.pts,
  	timeseries.json = tmp_timeseries.json,
  	timeseries.newpoints = tmp_timeseries.newpoints;
    
  DROP TEMPORARY TABLE IF EXISTS standard_pts;

END LOOP cik_loop;

#release resources
CLOSE ciks;
DROP TEMPORARY TABLE IF EXISTS tmp_adsh;
DROP TEMPORARY TABLE IF EXISTS tmp_timeseries;
CALL dropIndexSafely('f_num', 'ix_adshtag');

#final update of timeseries’ co name, tag name, and tag description from f-tag and f_sub

#get latest definition of all standard tag into temp table
UPDATE standardtag st, timeseries ts
set ts.tlabel=st.tlabel, ts.doc=st.doc
where ts.tag=st.tag;

#get latest company name too
update timeseries ts 
  inner join f_sub s on ts.cik = s.cik 
  inner join (select max(period) as period, cik from f_sub group by cik) mxs on mxs.cik = s.cik and mxs.period = s.period 
set ts.coname = s.name;

END$$
DELIMITER ;
