import gradio as gr
import contextlib
import wave
import os
from google import genai
from google.genai import types

# --- User Setup ---
# Create a file named id_pw.py in the same directory
# and add your API key like this:
# API_KEY = "YOUR_API_KEY_HERE"

try:
    API_KEY = os.getenv('API_KEY')
except ImportError:
    print("ERROR: Could not import API_KEY. Please create an 'id_pw.py' file with your Google API Key.")
    API_KEY = "YOUR_API_KEY_HERE" # Fallback to prevent crash

# --- Gemini Model and Client Configuration ---
try:
    client = genai.Client(api_key=API_KEY)
    LLM_MODEL_ID = "gemini-2.0-flash"
    TTS_MODEL_ID = "gemini-2.5-flash-preview-tts"
except Exception as e:
    print(f"Error initializing Google GenAI Client: {e}")
    client = None

# --- Helper Functions ---
file_index = 0

@contextlib.contextmanager
def wave_file(filename, channels=1, rate=24000, sample_width=2):
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        yield wf

def save_audio_blob_and_get_path(blob):
    global file_index
    file_index += 1
    fname = f'podcast_output_{file_index}.wav'
    with wave_file(fname) as wav:
        wav.writeframes(blob.data)
    return fname

# --- Voice Selection Dictionaries ---
female_voices = {
    "Zephyr": "Bright", "Kore": "Firm", "Leda": "Youthful", "Aoede": "Breezy",
    "Callirrhoe": "Easy-going", "Autonoe": "Bright", "Umbriel": "Easy-going",
    "Despina": "Smooth", "Erinome": "Clear", "Laomedeia": "Upbeat", "Achernar": "Soft",
    "Pulcherrima": "Forward", "Achird": "Friendly", "Vindemiatrix": "Gentle",
    "Sadachbia": "Lively", "Sulafat": "Warm"
}

male_voices = {
    "Puck": "Upbeat", "Charon": "Informative", "Fenrir": "Excitable", "Orus": "Firm",
    "Enceladus": "Breathy", "Iapetus": "Clear", "Algieba": "Smooth", "Algenib": "Gravelly",
    "Rasalgethi": "Informative", "Alnilam": "Firm", "Schedar": "Even", "Gacrux": "Mature",
    "Zubenelgenubi": "Casual", "Sadaltager": "Knowledgeable"
}
all_voices = {f"[F] {k} ({v})": k for k, v in female_voices.items()}
all_voices.update({f"[M] {k} ({v})": k for k, v in male_voices.items()})

# --- Core Functions ---
def generate_transcript_and_prompt(audio_input):
    if audio_input is None:
        raise gr.Error("Please record your podcast idea first.")
    if not client:
        raise gr.Error("GenAI Client not initialized. Please check your API Key.")

    # Update step to processing
    yield (
        1.5,  # step_state
        "🎙️ Uploading audio and generating prompt...",  # processing_status
        "",  # improved_prompt_display
        gr.update(value="", show_label=True),  # transcript_display with loading
        ""   # full_transcript_state
    )

    try:
        sample_rate, audio_data = audio_input
        input_audio_path = "user_prompt_input.wav"
        with wave.open(input_audio_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data.tobytes())

        uploaded_file = client.files.upload(file=input_audio_path)
        
    except Exception as e:
        print(f"Error occurred: {e}")
        yield (
            1,  # step_state
            f"❌ Error: {str(e)}",  # processing_status
            "",  # improved_prompt_display
            "",  # transcript_display
            ""   # full_transcript_state
        )
        return

    # Generate the improved prompt
    prompt_generation_prompt = """
        Your task:
        You are a prompt generator that takes a spoken user idea and converts it into a detailed, high-quality prompt 
        to be used for a text-to-speech dialogue model.
        Analyze the user's spoken input and extract the following information:
        - Characters: Who are the speakers? What are their personalities?
        - Scenario / Topic: What is the conversation about?
        - Tone / Style: What is the mood (e.g., casual, professional, educational)?
        - Language mix: Are multiple languages or specific accents mentioned?
        - Special rules: Are there any other instructions like correcting mistakes?
        Use the extracted data to build the final prompt. If any field is missing, use generic but sensible assumptions.
        Your output should:
        - Describe the roles, personalities, and speaking styles of each character.
        - Clearly explain the scenario and context of the conversation.
        - Specify the tone and style.
        - Include clear instructions for language usage.
        - Describe how to handle corrections, vocabulary explanations, and mistakes (if applicable).
        - Provide clear output formatting instructions (e.g., "Only output dialogue, labeled with character names").
        - Avoid adding any extra narration, sound effects, or non-dialogue text.
        Output ONLY the improved prompt itself, not any commentary or explanation.
        Be explicit, professional, and detailed to ensure the TTS model fully understands the task.
        """
    
    generate_prompt_response = client.models.generate_content(
        model=LLM_MODEL_ID,
        contents=[prompt_generation_prompt, uploaded_file]
    )
    generated_prompt = generate_prompt_response.text
    
    yield (
        1.5,  # step_state
        "📝 Prompt generated. Now generating transcript...",  # processing_status
        generated_prompt,  # improved_prompt_display
        gr.update(value="", show_label=True),  # transcript_display still loading
        ""   # full_transcript_state
    )

    # Generate the transcript using the new prompt (streaming)
    transcript = ""
    for chunk in client.models.generate_content_stream(
        model=LLM_MODEL_ID,
        contents=generated_prompt,
    ):
        if hasattr(chunk, 'text'):
            transcript += chunk.text
            yield (
                1.5,  # step_state
                "📝 Generating transcript...",  # processing_status
                generated_prompt,  # improved_prompt_display
                transcript,  # transcript_display
                transcript  # full_transcript_state
            )

    # Clean up
    client.files.delete(name=uploaded_file.name)
    os.remove(input_audio_path)
    
    # Move to step 2 (configuration)
    yield (
        2,  # step_state
        "✅ Transcript generated successfully!",  # processing_status
        generated_prompt,  # improved_prompt_display
        transcript,  # transcript_display
        transcript  # full_transcript_state
    )

def generate_audio(transcript, num_speakers, sp1_name, sp1_voice, sp2_name, sp2_voice):
    if not transcript:
        raise gr.Error("Transcript has not been generated yet.")
    if not sp1_name or not sp1_voice:
        raise gr.Error("Please provide a name and select a voice for Speaker 1.")
    if not client:
        raise gr.Error("GenAI Client not initialized. Please check your API Key.")

    # Move to processing state with loading audio
    yield (
        2.5,  # step_state
        "🎧 Generating podcast audio...",  # audio_status
        gr.update(value=None, show_label=True)  # podcast_output with loading animation
    )

    speaker_configs = []
    
    # Speaker 1 config
    voice_name_1 = all_voices[sp1_voice]
    speaker_configs.append(types.SpeakerVoiceConfig(
        speaker=sp1_name,
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name_1)
        )
    ))

    # Speaker 2 config (if applicable)
    if num_speakers == "2":
        if not sp2_name or not sp2_voice:
            raise gr.Error("Please provide a name and select a voice for Speaker 2.")
        voice_name_2 = all_voices[sp2_voice]
        speaker_configs.append(types.SpeakerVoiceConfig(
            speaker=sp2_name,
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name_2)
            )
        ))
    
    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=speaker_configs
            )
        )
    )

    try:
        response = client.models.generate_content(
            model=TTS_MODEL_ID,
            contents=[transcript],
            config=config,
        )
        
        # Save the audio and get the path
        audio_path = save_audio_blob_and_get_path(response.candidates[0].content.parts[0].inline_data)
        
        # Move to final step
        yield (
            3,  # step_state
            "✅ Podcast generated successfully!",  # audio_status
            gr.update(value=audio_path, show_label=True)  # podcast_output with actual audio
        )
        
    except Exception as e:
        yield (
            2,  # step_state
            f"❌ Error generating audio: {str(e)}",  # audio_status
            gr.update(value=None, show_label=True)  # podcast_output
        )

def update_speaker_visibility(num_speakers):
    if num_speakers == "1":
        return gr.update(visible=False)
    else:
        return gr.update(visible=True)

def restart_process():
    return (
        1,                           # step_state
        "",                          # processing_status
        "",                          # audio_status
        "",                          # improved_prompt_display
        "",                          # transcript_display
        "",                          # full_transcript_state
        gr.update(value=None),       # podcast_output
        gr.update(value=None),       # audio_prompt_input
        ""                           # final_transcript_step3_display
    )

# --- Gradio Interface Layout ---
with gr.Blocks(theme=gr.themes.Soft(), title="Gemini Podcast Studio") as demo:
    gr.Markdown("# 🎙️ Gemini Podcast Studio")
    gr.Markdown("Create a short podcast dialogue from a simple idea.")
    
    # State management
    step_state = gr.State(1)  # 1: recording, 1.5: processing, 2: configuring, 2.5: generating audio, 3: playback
    full_transcript_state = gr.State("")
    
    # Progress indicator
    progress_bar = gr.HTML("""
        <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; margin: 20px 0;">
            <div id="progress" style="width: 33%; height: 30px; background-color: #4CAF50; border-radius: 10px; text-align: center; line-height: 30px; color: white; font-weight: bold;">
                Step 1: Record Idea
            </div>
        </div>
    """)
    
    # Step 1: Recording Interface
    with gr.Column(visible=True) as step1_container:
        gr.Markdown("## 🎙️ Step 1: Record Your Podcast Idea")
        gr.Markdown(
            """
            Record yourself describing the podcast. Please include:
            - **Characters:** Names and brief traits (e.g., "Anna – cheerful", "Mark – serious")
            - **Scenario/Topic:** What's the conversation about?
            - **Tone/Style:** Mood or style (e.g., "friendly", "formal")  
            - **Language mix:** Which languages, and when to switch? Any accents?
            - **Special rules:** Any extra instructions (e.g., corrections, explanations)
            """
        )
        audio_prompt_input = gr.Audio(sources=["microphone"], type="numpy", label="Record Your Podcast Idea")
        generate_button = gr.Button("▶️ Generate Prompt & Transcript", variant="primary", size="lg")
    
    # Processing Step 1
    with gr.Column(visible=False) as processing_container:
        gr.Markdown("## ⏳ Processing Your Idea...")
        processing_status = gr.Textbox(
            label="Status", 
            interactive=False, 
            show_label=True,
            placeholder="Processing status will appear here..."
        )
        
        with gr.Group():
            with gr.Accordion("Generated Prompt", open=False):
                improved_prompt_display = gr.Textbox(label="Detailed Prompt", lines=5, interactive=False)
            
            transcript_display = gr.Textbox(
                label="Generated Transcript", 
                lines=10, 
                interactive=False, 
                placeholder="Transcript will appear here as it generates..."
            )
    
    # Step 2: Configuration Interface  
    with gr.Column(visible=False) as step2_container:
        gr.Markdown("## ⚙️ Step 2: Configure Your Podcast")
        
        with gr.Group():
            final_transcript_display = gr.Textbox(
                label="Final Transcript", 
                lines=8, 
                interactive=False,
                placeholder="Transcript will appear here...",
                autoscroll=False
            )
        
        gr.Markdown("### Speaker Configuration")
        num_speakers_selector = gr.Radio(["1", "2"], label="Number of Speakers", value="2")
        
        with gr.Row():
            with gr.Group():
                speaker1_name = gr.Textbox(label="Speaker 1 Name", value="Sarah")
                speaker1_voice = gr.Dropdown(list(all_voices.keys()), label="Speaker 1 Voice", value="[F] Leda (Youthful)")
            
            with gr.Group(visible=True) as speaker2_group:
                speaker2_name = gr.Textbox(label="Speaker 2 Name", value="Jisoo")
                speaker2_voice = gr.Dropdown(list(all_voices.keys()), label="Speaker 2 Voice", value="[F] Achird (Friendly)")
        
        with gr.Row():
            back_to_step1_button = gr.Button("← Back to Recording", variant="secondary")
            generate_audio_button = gr.Button("🎧 Generate Podcast Audio", variant="primary", size="lg")
    
    # Processing Step 2
    with gr.Column(visible=False) as audio_processing_container:
        gr.Markdown("## 🎧 Generating Your Podcast...")
        audio_status = gr.Textbox(
            label="Audio Generation Status", 
            interactive=False, 
            show_label=True,
            placeholder="Audio generation status will appear here..."
        )
        gr.Markdown("This may take a moment while we synthesize the audio with your selected voices.")
        
        # Audio component that will show loading animation when None
        podcast_output = gr.Audio(
            label="Final Podcast", 
            type="filepath", 
            interactive=False,
            show_label=True
        )
    
    # Step 3: Playback Interface
    with gr.Column(visible=False) as step3_container:
        gr.Markdown("## 🎉 Your Podcast is Ready!")
        
        # Duplicate audio component for step 3 display
        podcast_output_final = gr.Audio(
            label="Your Generated Podcast", 
            type="filepath", 
            interactive=False,
            show_label=True
        )
        
        with gr.Row():
            restart_button = gr.Button("🔄 Create Another Podcast", variant="secondary", size="lg")
        
        gr.Markdown("💡 **Tip:** Right-click the audio player above and select 'Save audio as...' to download your podcast.")

        final_transcript_step3_display = gr.Textbox(
            label="Final Transcript", 
            lines=10, 
            interactive=False,
            placeholder="Transcript will appear here...",
            autoscroll=False
        )

    # Function to update UI based on step
    def update_ui_based_on_step(step):
        # Update progress bar
        if step == 1:
            progress_html = """
                <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; margin: 20px 0;">
                    <div style="width: 33%; height: 30px; background-color: #4CAF50; border-radius: 10px; text-align: center; line-height: 30px; color: white; font-weight: bold;">
                        Step 1: Record Idea
                    </div>
                </div>
            """
        elif step == 1.5:
            progress_html = """
                <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; margin: 20px 0;">
                    <div style="width: 50%; height: 30px; background-color: #FF9800; border-radius: 10px; text-align: center; line-height: 30px; color: white; font-weight: bold;">
                        Processing...
                    </div>
                </div>
            """
        elif step == 2:
            progress_html = """
                <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; margin: 20px 0;">
                    <div style="width: 66%; height: 30px; background-color: #4CAF50; border-radius: 10px; text-align: center; line-height: 30px; color: white; font-weight: bold;">
                        Step 2: Configure
                    </div>
                </div>
            """
        elif step == 2.5:
            progress_html = """
                <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; margin: 20px 0;">
                    <div style="width: 83%; height: 30px; background-color: #FF9800; border-radius: 10px; text-align: center; line-height: 30px; color: white; font-weight: bold;">
                        Generating Audio...
                    </div>
                </div>
            """
        else:  # step == 3
            progress_html = """
                <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; margin: 20px 0;">
                    <div style="width: 100%; height: 30px; background-color: #4CAF50; border-radius: 10px; text-align: center; line-height: 30px; color: white; font-weight: bold;">
                        Complete! 🎉
                    </div>
                </div>
            """
        
        return (
            progress_html,                      # progress_bar
            gr.update(visible=(step == 1)),     # step1_container
            gr.update(visible=(step == 1.5)),   # processing_container
            gr.update(visible=(step == 2)),     # step2_container
            gr.update(visible=(step == 2.5)),   # audio_processing_container
            gr.update(visible=(step == 3))      # step3_container
        )

    # Event Listeners
    step_state.change(
        fn=update_ui_based_on_step,
        inputs=[step_state],
        outputs=[progress_bar, step1_container, processing_container, step2_container, audio_processing_container, step3_container]
    )
    
    num_speakers_selector.change(
        fn=update_speaker_visibility,
        inputs=num_speakers_selector,
        outputs=speaker2_group
    )

    generate_button.click(
        fn=generate_transcript_and_prompt,
        inputs=[audio_prompt_input],
        outputs=[step_state, processing_status, improved_prompt_display, transcript_display, full_transcript_state]
    )
    
    # Update the final transcript display when moving to step 2
    full_transcript_state.change(
        fn=lambda x: x,
        inputs=[full_transcript_state],
        outputs=[final_transcript_display]
    )
    
    generate_audio_button.click(
        fn=generate_audio,
        inputs=[full_transcript_state, num_speakers_selector, speaker1_name, speaker1_voice, speaker2_name, speaker2_voice],
        outputs=[step_state, audio_status, podcast_output]
    )
    
    # Update final audio display when moving to step 3
    podcast_output.change(
        fn=lambda x: x,
        inputs=[podcast_output],
        outputs=[podcast_output_final]
    )

    full_transcript_state.change(
        fn=lambda x: x,
        inputs=[full_transcript_state],
        outputs=[final_transcript_display]
    )
    
    step_state.change(
        fn=lambda step, transcript: transcript if step == 3 else "",
        inputs=[step_state, full_transcript_state],
        outputs=[final_transcript_step3_display]
    )
    
    back_to_step1_button.click(
        fn=lambda: 1,
        outputs=[step_state]
    )
    
    restart_button.click(
        fn=restart_process,
        outputs=[step_state, processing_status, audio_status, improved_prompt_display, transcript_display, full_transcript_state, podcast_output, audio_prompt_input, final_transcript_step3_display]
    )

if __name__ == "__main__":
    demo.launch()
    