import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://rvjzubrksvaivcvmrqmi.supabase.co'
const supabasePublishableKey = 'sb_publishable_-I_VNv-8UqjoAoYtyV3Tfw_C4vaCd0Z'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
