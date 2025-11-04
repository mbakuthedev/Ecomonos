const https = require('https');

class AIService {
  constructor() {
    this.openaiApiKey = null;
    this.groqApiKey = null;
    this.openaiBaseURL = 'https://api.openai.com/v1';
    this.groqBaseURL = 'https://api.groq.com/openai/v1';
    this.openaiModel = 'gpt-4o-mini';
    this.groqModel = 'llama-3.1-8b-instant'; // Fast and capable Groq model (primary)
  }

  setOpenAIKey(key) {
    this.openaiApiKey = key;
  }

  setGroqKey(key) {
    this.groqApiKey = key;
  }

  setApiKey(key) {
    // Backward compatibility - set OpenAI key
    this.openaiApiKey = key;
  }

  hasApiKey() {
    return !!(this.openaiApiKey || this.groqApiKey);
  }

  // Extract wait time from rate limit error message
  extractWaitTime(errorMessage) {
    // Groq error format: "Please try again in X.XXs"
    const waitMatch = errorMessage.match(/try again in ([\d.]+)s/i);
    if (waitMatch) {
      const seconds = parseFloat(waitMatch[1]);
      return Math.ceil(seconds * 1000); // Convert to milliseconds, round up
    }
    return null;
  }

  // Check if error is a rate limit error
  isRateLimitError(error) {
    const message = error.message || error.toString();
    return message.includes('rate limit') || 
           message.includes('Rate limit') ||
           message.includes('TPM') ||
           message.includes('tokens per minute');
  }

  async makeRequest(endpoint, data, provider = 'openai', retryCount = 0) {
    const isGroq = provider === 'groq';
    const apiKey = isGroq ? this.groqApiKey : this.openaiApiKey;
    const baseURL = isGroq ? this.groqBaseURL : this.openaiBaseURL;
    const hostname = isGroq ? 'api.groq.com' : 'api.openai.com';
    const path = isGroq ? `/openai/v1${endpoint}` : endpoint;
    const maxRetries = 3;

    if (!apiKey) {
      throw new Error(`${isGroq ? 'Groq' : 'OpenAI'} API key not set.`);
    }

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      
      const options = {
        hostname: hostname,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(responseData);
            if (json.error) {
              const error = new Error(json.error.message || 'API error');
              
              // Handle rate limit errors with retry
              if (this.isRateLimitError(error) && retryCount < maxRetries) {
                const waitTime = this.extractWaitTime(error.message) || (1000 * Math.pow(2, retryCount));
                console.log(`Rate limit hit, waiting ${waitTime}ms before retry ${retryCount + 1}/${maxRetries}`);
                
                setTimeout(() => {
                  this.makeRequest(endpoint, data, provider, retryCount + 1)
                    .then(resolve)
                    .catch(reject);
                }, waitTime);
                return;
              }
              
              reject(error);
            } else {
              resolve(json);
            }
          } catch (error) {
            reject(new Error('Failed to parse AI response'));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  async chatCompletion(messages, systemPrompt = null, provider = 'groq') {
    const messagesArray = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const model = provider === 'groq' ? this.groqModel : this.openaiModel;
    const endpoint = '/chat/completions';

    try {
      const response = await this.makeRequest(endpoint, {
        model: model,
        messages: messagesArray,
        temperature: 0.7,
        max_tokens: 800 // Reduced to avoid rate limits
      }, provider);

      return response.choices[0].message.content;
    } catch (error) {
      // If Groq fails (including rate limits after retries) and we have OpenAI key, try OpenAI
      if (provider === 'groq' && this.openaiApiKey) {
        if (this.isRateLimitError(error)) {
          console.log('Groq rate limit reached, falling back to OpenAI');
        } else {
          console.log('Groq request failed, falling back to OpenAI:', error.message);
        }
        return this.chatCompletion(messages, systemPrompt, 'openai');
      }
      throw error;
    }
  }

  // Smart Paste - Clean and format text
  async smartPaste(text, options = {}) {
    const { removeLineBreaks = false, formatJSON = false, rewriteTone = null, reformat = false } = options;
    
    let prompt = 'Clean and format the following text. ';
    
    if (removeLineBreaks) {
      prompt += 'Remove unnecessary line breaks and extra whitespace. ';
    }
    
    if (formatJSON) {
      prompt += 'If the text contains JSON data, format it as valid, properly indented JSON. ';
    }
    
    if (rewriteTone) {
      prompt += `Rewrite the text in a ${rewriteTone} tone. `;
    }
    
    if (reformat) {
      prompt += 'Reformat the text for better readability. ';
    }
    
    prompt += 'IMPORTANT: Return ONLY the cleaned/formatted plain text output. Do not wrap it in JSON, markdown code blocks, or any other formatting. Return the actual text content directly, with no explanations, no JSON structures, and no code block markers.';
    
    const result = await this.chatCompletion([
      { role: 'user', content: `${prompt}\n\nText:\n${text}` }
    ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
    
    // Clean up the result - remove any JSON wrapping or code blocks
    let cleanedResult = result.trim();
    
    // Remove markdown code blocks if present
    if (cleanedResult.startsWith('```')) {
      const lines = cleanedResult.split('\n');
      if (lines.length > 1 && lines[0].startsWith('```')) {
        lines.shift(); // Remove opening ```
        if (lines[lines.length - 1].trim() === '```') {
          lines.pop(); // Remove closing ```
        }
        cleanedResult = lines.join('\n').trim();
      }
    }
    
    // Remove JSON wrapping if present (e.g., {"text": "..."} or {"result": "..."})
    try {
      const jsonMatch = cleanedResult.match(/^\{[^}]*"(?:text|result|content|output)"\s*:\s*"([^"]+)"\s*\}$/);
      if (jsonMatch) {
        cleanedResult = jsonMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    } catch (e) {
      // Not JSON, keep as is
    }
    
    return cleanedResult;
  }

  // Generate embeddings for semantic search
  async generateEmbedding(text, provider = 'openai') {
    const endpoint = '/embeddings';
    const model = 'text-embedding-3-small';
    
    // Note: Groq doesn't have embeddings API, so we always use OpenAI for embeddings
    // or fallback to keyword search
    if (provider === 'groq') {
      throw new Error('Groq does not support embeddings. Use OpenAI or keyword search.');
    }

    try {
      const response = await this.makeRequest(endpoint, {
        model: model,
        input: text
      }, provider);
      return response.data[0].embedding;
    } catch (error) {
      // If OpenAI fails and we have Groq key, we can't use embeddings
      // Fallback will be handled by semanticSearch
      throw error;
    }
  }

  // Semantic search - find similar clipboard items
  async semanticSearch(query, items, limit = 5) {
    try {
      // Try OpenAI embeddings first (Groq doesn't support embeddings)
      if (this.openaiApiKey) {
        const queryEmbedding = await this.generateEmbedding(query, 'openai');
        
        // Calculate cosine similarity
        const similarities = items.map(item => {
          const similarity = this.cosineSimilarity(queryEmbedding, item.embedding || []);
          return { item, similarity };
        });
        
        return similarities
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit)
          .map(s => s.item);
      }
    } catch (error) {
      console.log('Embedding search failed, using keyword search:', error.message);
    }
    
    // Fallback to keyword search or use Groq for semantic understanding
    try {
      if (this.groqApiKey) {
        // Use Groq to find semantically similar items (limit items to reduce token usage)
        const itemsText = items.slice(0, 15).map((item, i) => 
          `${i + 1}. ${item.text.substring(0, 80)}`
        ).join('\n');
        
        const prompt = `Given the query: "${query}"\n\nFind the most relevant items from this list:\n${itemsText}\n\nReturn only the numbers (comma-separated) of the most relevant items, max ${limit} items.`;
        
        const response = await this.chatCompletion([
          { role: 'user', content: prompt }
        ], null, 'groq');
        
        // Parse response to extract item numbers
        const numbers = response.match(/\d+/g);
        if (numbers) {
          const indices = numbers.map(n => parseInt(n) - 1).filter(i => i >= 0 && i < items.length);
          return indices.slice(0, limit).map(i => items[i]);
        }
      }
    } catch (error) {
      // If rate limited, silently fall back to keyword search
      if (this.isRateLimitError(error)) {
        console.log('Groq rate limit reached, using keyword search');
      } else {
        console.log('Groq semantic search failed, using keyword search:', error.message);
      }
    }
    
    // Final fallback: keyword search
    const queryLower = query.toLowerCase();
    return items
      .filter(item => item.text.toLowerCase().includes(queryLower))
      .slice(0, limit);
  }

  // Simple cosine similarity (for when embeddings are available)
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Auto Reply Generator
  async generateReply(messages, context = '') {
    const messagesText = Array.isArray(messages) 
      ? messages.map((m, i) => `Message ${i + 1}: ${m}`).join('\n\n')
      : messages;

    const prompt = `You are a helpful assistant. Based on the following messages, draft a concise and appropriate reply. ${context ? `Context: ${context}` : ''}\n\nMessages:\n${messagesText}\n\nDraft a reply:`;

    return await this.chatCompletion([
      { role: 'user', content: prompt }
    ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
  }

  // Instant Formatter
  async formatText(text, formatType) {
    const formatPrompts = {
      'html-to-markdown': 'Convert the following HTML to clean Markdown format. Return only the Markdown, no explanations:\n\n',
      'markdown-to-html': 'Convert the following Markdown to HTML format. Return only the HTML, no explanations:\n\n',
      'json-format': 'Format the following JSON with proper indentation. Return only the formatted JSON, no explanations:\n\n',
      'code-format': 'Format the following code for better readability. Return only the formatted code, no explanations:\n\n',
      'remove-formatting': 'Remove all formatting from the following text and return plain text only:\n\n',
      'capitalize': 'Capitalize the following text properly:\n\n',
      'lowercase': 'Convert the following text to lowercase:\n\n',
      'uppercase': 'Convert the following text to UPPERCASE:\n\n'
    };

    const prompt = formatPrompts[formatType] || formatPrompts['remove-formatting'];
    
    return await this.chatCompletion([
      { role: 'user', content: `${prompt}${text}` }
    ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
  }

  // Auto-categorize clipboard item
  async categorizeText(text) {
    const categories = ['code', 'email', 'link', 'note', 'password', 'number', 'command', 'json', 'xml', 'html', 'other'];
    
    const prompt = `Categorize the following text into one of these categories: ${categories.join(', ')}. Return only the category name, nothing else.\n\nText: ${text.substring(0, 300)}`; // Reduced from 500 to save tokens

    try {
      const category = await this.chatCompletion([
        { role: 'user', content: prompt }
      ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
      
      // Clean and normalize the response
      const cleanCategory = category.trim().toLowerCase();
      return categories.find(c => cleanCategory.includes(c)) || 'other';
    } catch (error) {
      // Fallback categorization
      if (text.includes('@') && text.includes('.')) return 'email';
      if (text.startsWith('http://') || text.startsWith('https://')) return 'link';
      if (/^[0-9]+$/.test(text.trim())) return 'number';
      if (text.includes('{') || text.includes('[')) return 'json';
      if (text.includes('<') && text.includes('>')) return 'html';
      if (text.includes('function') || text.includes('const ') || text.includes('var ')) return 'code';
      return 'note';
    }
  }

  // Batch categorize multiple items
  async batchCategorize(items) {
    const results = [];
    for (const item of items) {
      try {
        const category = await this.categorizeText(item.text);
        results.push({ ...item, category });
      } catch (error) {
        results.push({ ...item, category: 'other' });
      }
    }
    return results;
  }
}

module.exports = new AIService();
