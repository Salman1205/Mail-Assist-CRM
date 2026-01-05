/**
 * Business Registration API Endpoint
 * POST /api/auth/register
 * 
 * Flow:
 * 1. Validate input (name, email, password, etc.)
 * 2. Check if business email already exists
 * 3. Hash password
 * 4. Create business record (not verified yet)
 * 5. Generate OTP code
 * 6. Send OTP email
 * 7. Return success (email sent)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  hashPassword,
  generateOTP,
  generateToken,
  generateOTPExpiry,
  validateBusinessRegistration,
} from '@/lib/auth-utils'
import { sendEmail } from '@/lib/email-service'
import { validateAccountType } from '@/lib/account-type-utils'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { businessName, businessEmail, ownerName, password, businessPhone } = body

    // 1. Validate input
    const validation = validateBusinessRegistration({
      businessName,
      businessEmail,
      ownerName,
      password,
      businessPhone,
    })

    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors },
        { status: 400 }
      )
    }

    // 2. Check account type - prevent creating business account if personal account exists
    const accountTypeValidation = await validateAccountType(businessEmail, 'business')

    if (!accountTypeValidation.isValid) {
      return NextResponse.json(
        { error: accountTypeValidation.error },
        { status: 409 }
      )
    }

    // If account exists and is already business type, check if verified
    if (accountTypeValidation.accountInfo?.exists && accountTypeValidation.accountInfo.accountType === 'business') {
      if (accountTypeValidation.accountInfo.isVerified) {
        return NextResponse.json(
          { error: 'This email is already registered as a business account. Please login instead.' },
          { status: 409 }
        )
      } else {
        // Business exists but not verified - allow re-registration
        // Delete old unverified business and its OTP tokens
        const { data: existingBusiness } = await supabase
          .from('businesses')
          .select('id')
          .eq('business_email', businessEmail.toLowerCase().trim())
          .maybeSingle()

        if (existingBusiness) {
          // Delete OTP tokens first (foreign key constraint)
          await supabase
            .from('email_verification_tokens')
            .delete()
            .eq('business_id', existingBusiness.id)

          // Then delete the business
          await supabase
            .from('businesses')
            .delete()
            .eq('id', existingBusiness.id)

          console.log('[Register] Deleted unverified business and OTP tokens:', existingBusiness.id)
        }
      }
    }

    // 3. Hash password
    const passwordHash = await hashPassword(password)

    // 4. Create business record (not verified)
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .insert({
        business_name: businessName.trim(),
        business_email: businessEmail.toLowerCase().trim(),
        business_phone: businessPhone?.trim() || null,
        owner_name: ownerName.trim(),
        password_hash: passwordHash,
        is_email_verified: false,
        subscription_tier: 'free',
      })
      .select()
      .single()

    if (businessError || !business) {
      console.error('[Register] Error creating business:', businessError)
      return NextResponse.json(
        { error: 'Failed to create business account. Please try again.' },
        { status: 500 }
      )
    }

    console.log('[Register] Business created:', business.id)

    // 5. Generate OTP code and token
    const otpCode = generateOTP()
    const token = generateToken()
    const expiresAt = generateOTPExpiry(10) // 10 minutes

    // 6. Store OTP in database
    const { error: otpError } = await supabase
      .from('email_verification_tokens')
      .insert({
        business_id: business.id,
        email: businessEmail.toLowerCase().trim(),
        token,
        otp_code: otpCode,
        expires_at: expiresAt.toISOString(),
      })

    if (otpError) {
      console.error('[Register] Error creating OTP:', otpError)
      // Rollback: delete business
      await supabase.from('businesses').delete().eq('id', business.id)
      return NextResponse.json(
        { error: 'Failed to generate verification code. Please try again.' },
        { status: 500 }
      )
    }

    console.log('[Register] OTP created:', otpCode)

    // 7. Send OTP email
    try {
      await sendEmail.otp({
        to: businessEmail,
        businessName,
        ownerName,
        otpCode,
      })

      console.log('[Register] OTP email sent to:', businessEmail)
    } catch (emailError) {
      console.error('[Register] Error sending email:', emailError)
      // Don't fail the registration, just log the error
      // In production, you might want to queue this for retry
    }

    // 8. Return success
    return NextResponse.json({
      success: true,
      message: 'Registration successful! Please check your email for the verification code.',
      businessId: business.id,
      email: businessEmail,
      // Include token for verification step
      verificationToken: token,
    })
  } catch (error) {
    console.error('[Register] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

// Handle OPTIONS request for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
