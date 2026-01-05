import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.warn(
    'Supabase environment variables are not set. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.'
  )
}

export const supabase = url && serviceKey
  ? createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
  : null


