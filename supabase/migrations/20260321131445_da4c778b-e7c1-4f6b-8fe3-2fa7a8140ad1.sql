UPDATE card_transactions 
SET matched_order_id = NULL, match_type = NULL, match_confidence = NULL 
WHERE id IN (
  'eff6ef7a-f9e5-4126-8a37-17b2d5a49726',
  'ad9546d2-34ac-4dc8-a840-fdd728e75e1d',
  '4ae00c94-68b3-4e84-9f08-ed01c8d18a34',
  'a34a8406-7937-41c8-8348-ad5569187c98',
  'deac7c84-ca77-45f4-a39d-d45e1f6fd13a'
)