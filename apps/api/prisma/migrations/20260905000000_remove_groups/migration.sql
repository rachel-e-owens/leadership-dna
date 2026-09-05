-- Remove group associations while preserving reports and their content.
ALTER TABLE "Report" DROP CONSTRAINT "Report_groupId_fkey";
ALTER TABLE "Report" DROP COLUMN "groupId";
DROP TABLE "GroupMember";
DROP TABLE "Group";
