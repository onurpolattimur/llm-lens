                                                                                                                                                                                                                   
  - Coding agent’ın HTTP(S) request’leri bu proxy’ye yönlenecek.                                                                                                                                                       
  - Proxy, LLM provider’a giden request/response’ları yakalayacak.
  - Web UI’da bunları timeline halinde göstereceğiz.                                                                                                                                                                   
  - Payload içinde model, endpoint, messages, tool calls, streaming chunks, latency, token usage, error vs. görülebilecek.                                                                                             
  - Proxyman/Charles gibi ama özellikle LLM API debugging için optimize edilmiş olacak.                                                                                                                                
                                                                                                                                                                                                                       
  Bence MVP için en doğru mimari şu:                                                                                                                                                                                   
                                                                                                                                                                                                                       
  Coding Agent                                                                                                                                                                                                         
     |                                                                                                                                                                                                               
     | HTTPS_PROXY / HTTP_PROXY                                                                                                                                                                                        
     v                                                                                                                                                                                                                 
  Local Proxy :8080                                                                                                                                                                                                    
     |                                                                                                                                                                                                                 
     | MITM TLS veya plain forward                                                                                                                                                                                     
     v                                                                                                                                                                                                                 
  Anthropic / OpenAI / Gemini / local LLM APIs                                                                                                                                                                       
                                                                                                                                                                                                                       
  Local Web UI :3000 veya :5173                                                                                                                                                                                      
     |
     v                                                                                                                                                                                                                 
  SQLite / in-memory event store                                                                                                                                                                                       
                                                                                                                                                                                                                       
  Önerdiğim MVP kapsamı                                                                                                                                                                                                
                                                                                                                                                                                                                       
  İlk sürümde şunları yapalım:                                                                                                                                                                                         
  
  1. Local proxy server                                                                                                                                                                                                
    - HTTP_PROXY=http://localhost:8080                                                                                                                                                                               
    - HTTPS_PROXY=http://localhost:8080                                                                                                                                                                                
    - NO_PROXY=localhost,127.0.0.1                                                                                                                                                                                     
    - CONNECT tunneling destekler.                                                                                                                                                                                     
    - LLM provider domain’lerini yakalar:                                                                                                                                                                              
        - api.anthropic.com                                                                                                                                                                                            
      - api.openai.com                                                                                                                                                                                                 
      - generativelanguage.googleapis.com                                                                                                                                                                              
      - ileride eklenebilir.                                                                                                                                                                                           
  2. MITM certificate flow                                                                                                                                                                                             
    - Proxy kendi local root CA sertifikasını üretir.                                                                                                                                                                  
    - Kullanıcı bu CA’yı sisteme veya ilgili runtime’a trust eder.                                                                                                                                                     
    - Proxy, hedef domain için anlık leaf certificate üretip HTTPS içeriğini okuyabilir.                                                                                                                               
    - Böylece request body / response body görülebilir.                                                                                                                                                                
  3. LLM-aware parser                                                                                                                                                                                                  
    - Anthropic Messages API                                                                                                                                                                                           
    - OpenAI Chat Completions / Responses API                                                                                                                                                                          
    - streaming SSE response                                                                                                                                                                                           
    - tool calls                                                                                                                                                                                                       
    - token usage                                                                                                                                                                                                      
    - latency                                                                                                                                                                                                          
    - errors                                                                                                                                                                                                           
  4. Timeline UI                                                                                                                                                                                                       
    - Sol tarafta request timeline.                                                                                                                                                                                    
    - Her item:
        - provider                                                                                                                                                                                                     
      - model                                                                                                                                                                                                          
      - endpoint                                                                                                                                                                                                       
      - status                                                                                                                                                                                                         
      - duration                                                                                                                                                                                                       
      - timestamp                                                                                                                                                                                                      
      - streaming olup olmadığı                                                                                                                                                                                        
    - Sağ tarafta detay:                                                                                                                                                                                             
        - request headers                                                                                                                                                                                              
      - request JSON                                                                                                                                                                                                   
      - response JSON                                                                                                                                                                                                  
      - normalized conversation view                                                                                                                                                                                   
      - raw view                                                                                                                                                                                                       
      - chunks view                                                                                                                                                                                                    
  5. Privacy / redaction                                                                                                                                                                                               
    - API key’ler default gizlenmeli.                                                                                                                                                                                  
    - Authorization header hiçbir zaman UI’da açık görünmemeli.                                                                                                                                                        
    - İsteğe bağlı redaction:                                                                                                                                                                                          
        - Authorization                                                                                                                                                                                                
      - x-api-key                                                                                                                                                                                                      
      - cookies                                                                                                                                                                                                        
      - user-defined regex                                                                                                                                                                                             
                                                                                                                                                                                                                       
  Sertifika süreci nasıl olacak?                                                                                                                                                                                       
                                                                                                                                                                                                                     
  HTTPS trafiğini okuyabilmek için iki seçenek var.                                                                                                                                                                    
                                                                                                                                                                                                                     
  Seçenek A — Kolay ama sınırlı: sadece forward proxy                                                                                                                                                                  
  
  Bu durumda coding agent şunu kullanır:                                                                                                                                                                               
                                                                                                                                                                                                                     
  export HTTPS_PROXY=http://localhost:8080                                                                                                                                                                             
  export HTTP_PROXY=http://localhost:8080                                                                                                                                                                              
                                                                                                                                                                                                                       
  Proxy HTTPS bağlantısını tüneller ama içeriği göremez.                                                                                                                                                               
                                                                                                                                                                                                                       
  Görülebilenler:                                                                                                                                                                                                      
  
  - domain                                                                                                                                                                                                             
  - port                                                                                                                                                                                                             
  - connect zamanı
  - byte size
  - latency

  Görülemeyenler:

  - JSON request body
  - JSON response body
  - model adı
  - messages                                                                                                                                                                                                           
  - tool calls
                                                                                                                                                                                                                       
  Bu bizim hedefimiz için yeterli değil.                                                                                                                                                                               
  
  Seçenek B — MITM proxy: doğru yaklaşım                                                                                                                                                                               
                                                                                                                                                                                                                     
  Burada proxy lokal bir CA üretir:                                                                                                                                                                                    
                                                                                                                                                                                                                     
  ~/.llm-inspector/certs/rootCA.pem                                                                                                                                                                                    
  ~/.llm-inspector/certs/rootCA-key.pem                                                                                                                                                                                
                                                                                                                                                                                                                       
  Sonra api.anthropic.com gibi domain’ler için runtime’da sertifika üretir.                                                                                                                                            
                                                                                                                                                                                                                       
  Kullanıcının root CA’yı trust etmesi gerekir.                                                                                                                                                                        
                                                                                                                                                                                                                     
  macOS için örnek akış:                                                                                                                                                                                               
                                                                                                                                                                                                                     
  open ~/.llm-inspector/certs/rootCA.pem                                                                                                                                                                               
                                                                                                                                                                                                                       
  Sonra Keychain Access’te:                                                                                                                                                                                            
                                                                                                                                                                                                                       
  1. Sertifikayı “System” veya “login” keychain’e ekle.                                                                                                                                                                
  2. Sertifikaya çift tıkla.                                                                                                                                                                                         
  3. “Trust” bölümünü aç.                                                                                                                                                                                              
  4. “When using this certificate” → “Always Trust”.                                                                                                                                                                   
  5. Kaydet.                                                                                                                                                                                                           
                                                                                                                                                                                                                       
  Alternatif terminal komutu:                                                                                                                                                                                          
                                                                                                                                                                                                                       
  sudo security add-trusted-cert \                                                                                                                                                                                     
    -d \                                                                                                                                                                                                               
    -r trustRoot \                                                                                                                                                                                                     
    -k /Library/Keychains/System.keychain \                                                                                                                                                                            
    ~/.llm-inspector/certs/rootCA.pem                                                                                                                                                                                  
                                                                                                                                                                                                                       
  Node.js tabanlı coding agent’lar için ayrıca gerekebilir:                                                                                                                                                            
                                                                                                                                                                                                                       
  export NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                   
                                                                                                                                                                                                                       
  Python tabanlı client’lar için gerekebilir:                                                                                                                                                                          
                                                                                                                                                                                                                       
  export REQUESTS_CA_BUNDLE="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                    
  export SSL_CERT_FILE="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                         
                                                                                                                                                                                                                       
  Ama idealde sistem trust store yeterli olur; bazı runtime’lar kendi CA bundle’ını kullandığı için yukarıdaki env’ler gerekebilir.                                                                                    
                                                                                                                                                                                                                       
  Coding agent’a vereceğin env variable’lar                                                                                                                                                                            
                                                                                                                                                                                                                     
  Başlangıç için:                                                                                                                                                                                                      
                                                                                                                                                                                                                     
  export HTTPS_PROXY=http://localhost:8080                                                                                                                                                                             
  export HTTP_PROXY=http://localhost:8080                                                                                                                                                                            
  export NO_PROXY=localhost,127.0.0.1                                                                                                                                                                                  
                                                                                                                                                                                                                       
  Node tabanlı agent için:                                                                                                                                                                                             
                                                                                                                                                                                                                       
  export NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                   
                                                                                                                                                                                                                       
  Python tabanlı agent için:                                                                                                                                                                                           
                                                                                                                                                                                                                       
  export REQUESTS_CA_BUNDLE="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                    
  export SSL_CERT_FILE="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                         
                                                                                                                                                                                                                       
  Eğer sadece belirli bir process için çalıştırmak istersen:                                                                                                                                                           
                                                                                                                                                                                                                       
  HTTPS_PROXY=http://localhost:8080 \                                                                                                                                                                                  
  HTTP_PROXY=http://localhost:8080 \                                                                                                                                                                                   
  NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/rootCA.pem" \                                                                                                                                                        
  your-coding-agent-command                                                                                                                                                                                            
                                                                                                                                                                                                                       
  Önerdiğim teknoloji stack’i                                                                                                                                                                                          
                                                                                                                                                                                                                     
  Bu proje için bence en pratik stack:                                                                                                                                                                                 
                                                                                                                                                                                                                     
  Backend/proxy                                                                                                                                                                                                        
                                                                                                                                                                                                                     
  Node.js + TypeScript                                                                                                                                                                                                 
                                                                                                                                                                                                                     
  Neden:                                                                                                                                                                                                               
                                                                                                                                                                                                                     
  - LLM tooling ekosistemiyle uyumlu.                                                                                                                                                                                  
  - Streaming/SSE parsing kolay.
  - WebSocket ile UI’ya canlı event göndermek kolay.                                                                                                                                                                   
  - Cross-platform desktop’a ileride taşımak kolay.                                                                                                                                                                    
                                                                                                                                                                                                                       
  Kütüphane seçenekleri:                                                                                                                                                                                               
                                                                                                                                                                                                                       
  - Proxy core:                                                                                                                                                                                                        
    - http-mitm-proxy veya custom http/net/tls                                                                                                                                                                       
  - Cert generation:                                                                                                                                                                                                   
    - node-forge                                                                                                                                                                                                       
  - DB:                                                                                                                                                                                                                
    - better-sqlite3                                                                                                                                                                                                   
  - Realtime:                                                                                                                                                                                                          
    - ws                                                                                                                                                                                                               
  - API:                                                                                                                                                                                                               
    - fastify                                                                                                                                                                                                          
                                                                                                                                                                                                                       
  Frontend                                                                                                                                                                                                             
                                                                                                                                                                                                                       
  - Vite                                                                                                                                                                                                               
  - React                                                                                                                                                                                                            
  - TypeScript
  - Tailwind                                                                                                                                                                                                           
  - shadcn/ui veya özel componentler                                                                                                                                                                                   
                                                                                                                                                                                                                       
  UI için özellikle iyi olacak şey:                                                                                                                                                                                    
                                                                                                                                                                                                                       
  Timeline                                                                                                                                                                                                             
    ├── Request started                                                                                                                                                                                              
    ├── Headers received                                                                                                                                                                                               
    ├── Stream chunk 1                                                                                                                                                                                                 
    ├── Stream chunk 2                                                                                                                                                                                                 
    ├── Tool call emitted                                                                                                                                                                                              
    ├── Final message                                                                                                                                                                                                  
    └── Usage received                                                                                                                                                                                                 
                                                                                                                                                                                                                       
  Veri modeli                                                                                                                                                                                                          
                                                                                                                                                                                                                       
  Basit MVP modeli:                                                                                                                                                                                                    
  
  type CapturedRequest = {                                                                                                                                                                                             
    id: string;                                                                                                                                                                                                        
    startedAt: string;
    completedAt?: string;                                                                                                                                                                                              
    provider: "anthropic" | "openai" | "google" | "unknown";                                                                                                                                                         
    method: string;                                                                                                                                                                                                    
    url: string;                                                                                                                                                                                                       
    host: string;                                                                                                                                                                                                      
    path: string;                                                                                                                                                                                                      
    statusCode?: number;                                                                                                                                                                                               
    durationMs?: number;                                                                                                                                                                                               
    requestHeaders: Record<string, string>;                                                                                                                                                                            
    responseHeaders?: Record<string, string>;                                                                                                                                                                          
    requestBody?: unknown;                                                                                                                                                                                             
    responseBody?: unknown;                                                                                                                                                                                            
    streamChunks?: StreamChunk[];                                                                                                                                                                                      
    error?: string;                                                                                                                                                                                                    
  };                                                                                                                                                                                                                   
                                                                                                                                                                                                                     
  type StreamChunk = {
    id: string;
    requestId: string;                                                                                                                                                                                                 
    timestamp: string;                                                                                                                                                                                                 
    raw: string;                                                                                                                                                                                                       
    parsed?: unknown;                                                                                                                                                                                                  
  };                                                                                                                                                                                                                   
                                                                                                                                                                                                                       
  LLM normalized view:                                                                                                                                                                                                 
                                                                                                                                                                                                                     
  type LlmTrace = {                                                                                                                                                                                                    
    requestId: string;                                                                                                                                                                                                 
    provider: string;                                                                                                                                                                                                  
    model?: string;                                                                                                                                                                                                    
    inputMessages?: NormalizedMessage[];                                                                                                                                                                               
    outputMessages?: NormalizedMessage[];                                                                                                                                                                              
    toolCalls?: NormalizedToolCall[];                                                                                                                                                                                  
    usage?: {                                                                                                                                                                                                          
      inputTokens?: number;                                                                                                                                                                                            
      outputTokens?: number;                                                                                                                                                                                           
      totalTokens?: number;                                                                                                                                                                                            
    };                                                                                                                                                                                                                 
  };                                                                                                                                                                                                                   
                                                                                                                                                                                                                       
  Timeline UI fikri                                                                                                                                                                                                    
  
  Ana ekran şöyle olabilir:                                                                                                                                                                                            
                                                                                                                                                                                                                     
  ┌─────────────────────────────────────────────────────────────┐                                                                                                                                                      
  │ LLM Inspector                         Proxy: localhost:8080 │                                                                                                                                                      
  ├───────────────────┬─────────────────────────────────────────┤                                                                                                                                                      
  │ Timeline          │ Request Detail                          │                                                                                                                                                      
  │                   │                                         │                                                                                                                                                      
  │ 17:21 Anthropic   │ POST /v1/messages                       │                                                                                                                                                      
  │  Claude Opus 4.7  │ Status: 200   Duration: 12.4s           │                                                                                                                                                      
  │  12.4s  200       │                                         │                                                                                                                                                      
  │                   │ [Conversation] [Raw] [Headers] [Chunks] │                                                                                                                                                      
  │ 17:19 OpenAI      │                                         │                                                                                                                                                      
  │  gpt-4.1          │ User                                    │                                                                                                                                                      
  │  2.1s  200        │   "Refactor this function..."           │                                                                                                                                                      
  │                   │                                         │                                                                                                                                                      
  │ 17:17 Anthropic   │ Assistant                               │                                                                                                                                                      
  │  streaming        │   tool_use: Read                        │                                                                                                                                                      
  │  31.8s  200       │   tool_result                           │                                                                                                                                                      
  │                   │   final answer...                       │                                                                                                                                                      
  └───────────────────┴─────────────────────────────────────────┘                                                                                                                                                      
                                                                                                                                                                                                                       
  Önemli edge case’ler                                                                                                                                                                                                 
                                                                                                                                                                                                                       
  Bunları baştan hesaba katalım:                                                                                                                                                                                       
                                                                                                                                                                                                                     
  1. Streaming response                                                                                                                                                                                                
    - LLM API’lerde response çoğunlukla SSE stream.                                                                                                                                                                  
    - Proxy response’u tüketip UI’ya chunk chunk göndermeli.                                                                                                                                                           
    - Aynı anda client’a da doğru şekilde forward etmeli.                                                                                                                                                              
    - Buffer edip sonra göndermek yanlış olur; agent yavaşlar.                                                                                                                                                         
  2. Gzip/br compression                                                                                                                                                                                               
    - Request/response compressed olabilir.                                                                                                                                                                            
    - Proxy body’yi decode edip saklamalı ama client’a orijinal semantic ile iletmeli.                                                                                                                                 
    - MVP’de accept-encoding header’ını sadeleştirip gzip/br’ı devre dışı bırakabiliriz:                                                                                                                               
  accept-encoding: identity                                                                                                                                                                                            
  3. API key güvenliği                                                                                                                                                                                                 
    - Auth header DB’ye plaintext kaydedilmemeli.                                                                                                                                                                      
    - UI’da maskeli gösterilmeli:                                                                                                                                                                                      
  sk-ant-...abcd                                                                                                                                                                                                       
  4. Large payload                                                                                                                                                                                                     
    - Büyük response’ları sınırlamak gerekebilir.                                                                                                                                                                      
    - MVP’de örneğin 10MB üstünü truncate edebiliriz.                                                                                                                                                                  
  5. Non-LLM traffic                                                                                                                                                                                                   
    - Ya tamamen ignore edilir.                                                                                                                                                                                        
    - Ya metadata-only kaydedilir.                                                                                                                                                                                     
    - Bence MVP’de sadece allowlist provider host’larını capture edelim.                                                                                                                                               
                                                                                                                                                                                                                       
  CLI deneyimi                                                                                                                                                                                                         
                                                                                                                                                                                                                       
  Bence güzel developer experience şöyle olmalı:                                                                                                                                                                       
                                                                                                                                                                                                                     
  llm-inspector start                                                                                                                                                                                                  
                                                                                                                                                                                                                       
  Output:                                                                                                                                                                                                              
                                                                                                                                                                                                                       
  LLM Inspector running                                                                                                                                                                                                
                                                                                                                                                                                                                       
  Proxy:                                                                                                                                                                                                               
    http://localhost:8080                                                                                                                                                                                              
                                                                                                                                                                                                                       
  Web UI:                                                                                                                                                                                                            
    http://localhost:3000                                                                                                                                                                                              
                                                                                                                                                                                                                       
  CA certificate:                                                                                                                                                                                                      
    ~/.llm-inspector/certs/rootCA.pem                                                                                                                                                                                  
                                                                                                                                                                                                                       
  To inspect Node.js agents:                                                                                                                                                                                           
    export HTTPS_PROXY=http://localhost:8080                                                                                                                                                                           
    export HTTP_PROXY=http://localhost:8080                                                                                                                                                                            
    export NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/rootCA.pem"                                                                                                                                                 
                                                                                                                                                                                                                       
  Certificate setup komutu:                                                                                                                                                                                            
                                                                                                                                                                                                                       
  llm-inspector cert install                                                                                                                                                                                           
                                                                                                                                                                                                                       
  macOS’ta:                                                                                                                                                                                                            
                                                                                                                                                                                                                       
  sudo security add-trusted-cert ...                                                                                                                                                                                   

  macOS’ta:                         

  sudo security add-trusted-cert ...

  Uninstall:                  

  llm-inspector cert uninstall   

  macOS’ta:                      

  sudo security add-trusted-cert ...               

  Uninstall:                

  llm-inspector cert uninstall               
                                     
  Güvenlik açısından net sınırlar            
                                       
  Bu tool sadece local debugging için tasarlanmalı.
                              
  Bence default davranışlar:         

  - Proxy sadece 127.0.0.1 üzerinde dinlesin.
  - Network’ten erişime kapalı olsun.
  - API key’ler saklanmasın veya maskelensin.
  - Raw export user action gerektirsin.
  - CA private key sadece local machine’de olsun.
  - CA uninstall komutu olsun.
  - UI’da “MITM active” net görünsün.
             
  İlk uygulama planı   
                 
  Bence şöyle ilerleyelim:
                
  1. Proje iskeleti
    - backend/                   
    - frontend/     
    - shared/                 
    - TypeScript config
    - dev scripts 
  2. Proxy MVP            
    - HTTP proxy            
    - HTTPS CONNECT
    - MITM certificate generation
    - host allowlist
    - request/response capture
  3. Anthropic parser
    - /v1/messages           
    - normal JSON response
    - streaming SSE response
  4. Realtime UI 
    - WebSocket event feed
    - timeline list
    - detail panel                   
    - raw JSON viewer          
  5. Certificate CLI guidance
    - cert generate
    - cert install
    - cert status                                                                                                                                                             
    - cert uninstall
  6. Persistence 
    - İlk aşamada in-memory olabilir.
    - Sonra SQLite’a geçiririz.             
                                                           
  Benim önerim                                                      

  Önce Anthropic API + Node.js agent senaryosuna odaklanalım. Çünkü coding agent’ların çoğu Node runtime içinde çalışıyor ve NODE_EXTRA_CA_CERTS ile daha kontrollü ilerleriz.

  İlk MVP hedefi:  

  Claude/Anthropic API requestlerini yakala,                                                                                                                                                                           
  streaming dahil response’u bozmayacak şekilde forward et,
  UI’da timeline + raw JSON + normalized conversation olarak göster.                                                                                                                                           
                                                                                                                                        
  Bunu oturttuktan sonra OpenAI/Gemini parser’larını eklemek kolay olur. 