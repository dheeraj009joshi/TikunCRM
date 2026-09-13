-- Run this on the NEW database after blobs are copied.
-- From the new VM (which can reach tikuncrmdb):
--   psql "host=tikuncrmdb.postgres.database.azure.com port=5432 dbname=LeedsCRM user=tikuncrm sslmode=require" -f scripts/rewrite_azure_urls.sql
--
-- Recordings -> tikuntech/tikuncrm
-- WhatsApp media -> tikuntech/whatsapp-media

BEGIN;

UPDATE call_logs
SET recording_url = replace(
    replace(
        replace(recording_url,
            'https://tikuntechwebimages.blob.core.windows.net/call-recordings/',
            'https://tikuntech.blob.core.windows.net/tikuncrm/'),
        'https://tikuntechwebimages.blob.core.windows.net/lead-stips/',
        'https://tikuntech.blob.core.windows.net/tikuncrm/'),
    'https://tikuntechwebimages.blob.core.windows.net/whatsapp-media/',
    'https://tikuntech.blob.core.windows.net/tikuncrm/')
WHERE recording_url LIKE '%tikuntechwebimages.blob.core.windows.net%';

UPDATE whatsapp_logs
SET media_urls = replace(media_urls::text,
    'https://tikuntechwebimages.blob.core.windows.net/whatsapp-media/',
    'https://tikuntech.blob.core.windows.net/whatsapp-media/')::jsonb
WHERE media_urls::text LIKE '%tikuntechwebimages.blob.core.windows.net/whatsapp-media/%';

UPDATE sms_logs
SET media_urls = replace(media_urls::text,
    'https://tikuntechwebimages.blob.core.windows.net/whatsapp-media/',
    'https://tikuntech.blob.core.windows.net/whatsapp-media/')::jsonb
WHERE media_urls::text LIKE '%tikuntechwebimages.blob.core.windows.net/whatsapp-media/%';

COMMIT;

-- Sanity checks:
-- SELECT COUNT(*) FROM call_logs WHERE recording_url LIKE '%tikuntechwebimages%';
-- SELECT COUNT(*) FROM call_logs WHERE recording_url LIKE '%tikuntech.blob.core.windows.net/tikuncrm/%';
-- SELECT COUNT(*) FROM whatsapp_logs WHERE media_urls::text LIKE '%tikuntechwebimages%';
