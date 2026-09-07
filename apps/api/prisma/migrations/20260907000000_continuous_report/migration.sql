-- Keep legacy blocks and notes intact. Documents are converted when first edited.
ALTER TABLE "Report" ADD COLUMN "document" JSONB,
ADD COLUMN "documentStyle" JSONB;
