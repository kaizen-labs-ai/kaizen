# Voice Input

Kaizen supports voice input for hands-free interaction. Speak your tasks instead of typing them.

## Setup

1. Go to **Settings > Voice** (`/settings/voice`)
2. Enable **Voice Input**
3. Optionally configure the transcription model and keyboard shortcut

## Configuration

### Transcription Model

Choose which model handles speech-to-text conversion. The default is `google/gemini-2.5-flash`, which provides fast and accurate transcription.

### Transcription Prompt

Customize the system prompt used for audio-to-text conversion. The default prompt is optimized for clean, accurate transcription that preserves your intent.

### Dictation Shortcut

Set a keyboard shortcut to start/stop voice recording. When you press the shortcut, Kaizen listens for your speech, transcribes it, and places the text in the chat input.

## How It Works

1. Press the dictation shortcut or click the voice input button
2. Speak your message
3. The audio is sent to the configured transcription model via OpenRouter
4. The transcribed text appears in the chat input
5. Review and send the message
