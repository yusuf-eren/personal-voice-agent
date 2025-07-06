const { VertexAI } = require('@google-cloud/vertexai');

/**
 * TODO(developer): Update these variables before running the sample.
 */
async function transcript_audio(projectId = 'PROJECT_ID') {
    const vertexAI = new VertexAI({
        project: projectId,
        location: 'us-central1'
    });

    const generativeModel = vertexAI.getGenerativeModel({
        model: 'gemini-2.0-flash-001'
    });

    const filePart = {
        file_data: {
            file_uri: 'gs://cloud-samples-data/generative-ai/audio/pixel.mp3',
            mime_type: 'audio/mpeg'
        }
    };
    const textPart = {
        text: `
    Can you transcribe this interview, in the format of timecode, speaker, caption?
    Use speaker A, speaker B, etc. to identify speakers.`
    };

    const request = {
        contents: [{ role: 'user', parts: [filePart, textPart] }]
    };

    const resp = await generativeModel.generateContent(request);
    const contentResponse = await resp.response;
    console.log(JSON.stringify(contentResponse));
}
