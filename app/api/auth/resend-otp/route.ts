/**
 * Resend OTP API Endpoint
 * POST /api/auth/resend-otp
 * 
 * Flow:
 * 1. Validate email and businessId
 * 2. Check if business exists and is not verified
 * 3. Delete old OTP tokens
 * 4. Generate new OTP
 * 5. Send email
 * 6. Return success
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateOTP, generateToken, generateOTPExpiry } from '@/lib/auth-utils'
import { sendEmail } from '@/lib/email-service'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, businessId } = body

    if (!email || !businessId) {
      return NextResponse.json(
        { error: 'Email and business ID are required' },
        { status: 400 }
      )
    }

    // Get business
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .eq('business_email', email.toLowerCase().trim())
      .single()

    if (businessError || !business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      )
    }

    if (business.is_email_verified) {
      return NextResponse.json(
        { error: 'Email is already verified' },
        { status: 400 }
      )
    }

    // Delete old unused verification tokens for this business
    await supabase
      .from('email_verification_tokens')
      .delete()
      .eq('business_id', businessId)
      .is('verified_at', null)

    // Generate new OTP
    const otpCode = generateOTP()
    const token = generateToken()
    const expiresAt = generateOTPExpiry(10)

    // Store new OTP
    const { error: otpError } = await supabase
      .from('email_verification_tokens')
      .insert({
        business_id: businessId,
        email: email.toLowerCase().trim(),
        token,
        otp_code: otpCode,
        expires_at: expiresAt.toISOString(),
      })

    if (otpError) {
      console.error('[ResendOTP] Error creating OTP:', otpError)
      return NextResponse.json(
        { error: 'Failed to generate new verification code' },
        { status: 500 }
      )
    }

    // Send OTP email
    try {
      await sendEmail.otp({
        to: email,
        businessName: business.business_name,
        ownerName: business.owner_name,
        otpCode,
      })
    } catch (emailError) {
      console.error('[ResendOTP] Error sending email:', emailError)
      // Don't fail the request, just log
    }

    console.log('[ResendOTP] New OTP sent to:', email)

    return NextResponse.json({
      success: true,
      message: 'A new verification code has been sent to your email',
    })
  } catch (error) {
    console.error('[ResendOTP] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
