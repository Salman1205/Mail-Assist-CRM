// Utility functions for business registration, invitation, and workspace switching
import { createClient } from '@supabase/supabase-js'

// Use service role key to bypass RLS
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

// 1. Prevent duplicate businesses on registration
export async function getOrCreateBusiness(businessEmail: string, businessData: any) {
  if (!supabase) {
    console.warn('Supabase client not initialized');
    return null;
  }
  const { data: existingBusiness } = await supabase
    .from('businesses')
    .select('id')
    .eq('business_email', businessEmail)
    .single()

  if (existingBusiness) {
    return existingBusiness.id
  } else {
    const { data: newBiz, error } = await supabase
      .from('businesses')
      .insert([{ business_email: businessEmail, ...businessData }])
      .select('id')
      .single()
    if (error) throw error
    return newBiz.id
  }
}

// 2. Invitation flow: link to existing user if present
export async function inviteOrLinkUserToBusiness(inviteEmail: string, businessId: string, userData: any) {
  if (!supabase) {
    console.warn('Supabase client not initialized');
    return null;
  }
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', inviteEmail)
    .eq('business_id', businessId)
    .single()

  if (existingUser) {
    // Optionally update role/status here
    return existingUser.id
  } else {
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ email: inviteEmail, business_id: businessId, ...userData }])
      .select('id')
      .single()
    if (error) throw error
    return newUser.id
  }
}

// 3. Get all businesses a user belongs to
export async function getBusinessesForUser(email: string) {
  if (!supabase) {
    console.warn('Supabase client not initialized');
    return null;
  }
  const { data } = await supabase
    .from('users')
    .select('business_id, business:business_id (business_name, business_email)')
    .eq('email', email)
  return data
}
