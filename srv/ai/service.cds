@(requires: 'authenticated-user')
@path: '/odata/v4/ai'
service AIService {
    type AIAnswer {
        answer           : String;
        model            : String;
        promptTokens     : Integer;
        completionTokens : Integer;
    }

    type ChatMessage {
        role    : String enum { user; assistant; };
        content : String;
    }

    /** Single question to the configured LLM (NVIDIA NIM). */
    action askAI(question : String not null, system : String, model : String) returns AIAnswer;

    /** Multi-turn chat; client sends the conversation so far (last message must be from user). */
    action chat(messages : many ChatMessage not null, system : String, model : String) returns AIAnswer;
}
