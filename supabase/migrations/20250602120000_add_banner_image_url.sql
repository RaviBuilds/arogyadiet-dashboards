ALTER TABLE products ADD COLUMN IF NOT EXISTS banner_image_url text;

UPDATE products
SET banner_image_url = image_urls[1]
WHERE banner_image_url IS NULL
  AND image_urls IS NOT NULL
  AND array_length(image_urls, 1) > 0;
