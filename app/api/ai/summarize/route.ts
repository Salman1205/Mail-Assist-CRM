import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { conversation } = await request.json()

    if (!conversation || typeof conversation !== "string") {
      return NextResponse.json(
        { error: "Conversation text is required" },
        { status: 400 }
      )
    }

    const apiKey = process.env.GROQ_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY not configured" },
        { status: 500 }
      )
    }

    // Call Groq API to generate summary
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates concise email conversation summaries. You will receive email content which may contain raw HTML. Extract the core message and meaning while ignoring technical metadata, CSS, or formatting tags. Provide a brief 2-3 sentence summary of what the conversation is about. Be direct and factual.',
          },
          {
            role: 'user',
            content: `Summarize this email conversation (which may contain HTML) in 2-3 sentences:\n\n${conversation}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 150,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Groq API error:', errorData)
      return NextResponse.json(
        { error: "Failed to generate summary" },
        { status: 500 }
      )
    }

    const data = await response.json()
    const summary = data.choices?.[0]?.message?.content?.trim() || "Unable to generate summary."

    return NextResponse.json({ summary })
  } catch (error) {
    console.error("Error generating summary:", error)
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    )
  }
}
