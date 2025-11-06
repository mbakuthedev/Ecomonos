const https = require('https');

class AIService {
  constructor() {
    this.openaiApiKey = null;
    this.groqApiKey = null;
    this.openaiBaseURL = 'https://api.openai.com/v1';
    this.groqBaseURL = 'https://api.groq.com/openai/v1';
    this.openaiModel = 'gpt-4o-mini';
    this.groqModel = 'llama-3.1-8b-instant'; // Fast and capable Groq model (primary)
    
    // Text size limits (to avoid token limit errors)
    // Roughly 1 token = 4 characters, so we limit to prevent exceeding API limits
    this.MAX_TEXT_LENGTH = 12000; // ~3000 tokens (safe for Groq's 6000 TPM limit)
    this.MAX_INPUT_LENGTH = 8000; // ~2000 tokens for input (leaves room for output)
    this.MAX_CATEGORIZE_LENGTH = 1000; // ~250 tokens for categorization
    this.MAX_SEARCH_ITEMS = 10; // Limit items in semantic search
    this.MAX_SEARCH_ITEM_LENGTH = 200; // Limit each item length in search
  }
  
  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }
  
  // Truncate text to max length
  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
  
  // Check if text is too large for AI processing
  isTextTooLarge(text, maxLength = this.MAX_TEXT_LENGTH) {
    return text && text.length > maxLength;
  }
  
  // Skip AI processing for large texts (return error)
  skipLargeTextError(text, operation) {
    return new Error(
      `Text is too large for ${operation} (${text.length} chars, max ${this.MAX_TEXT_LENGTH}). ` +
      `Please use shorter text or split it into smaller parts.`
    );
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
    // Estimate total tokens in messages
    const messagesText = messages.map(m => m.content || '').join(' ');
    const systemText = systemPrompt || '';
    const totalText = systemText + ' ' + messagesText;
    const estimatedTokens = this.estimateTokens(totalText);
    
    // Check if request is too large
    if (estimatedTokens > 4000) {
      const error = new Error(`Request too large (estimated ${estimatedTokens} tokens, max ~4000). Please reduce text size.`);
      // If Groq and we have OpenAI, try OpenAI (it might have higher limits)
      if (provider === 'groq' && this.openaiApiKey) {
        console.log('Groq request too large, trying OpenAI');
        return this.chatCompletion(messages, systemPrompt, 'openai');
      }
      throw error;
    }
    
    const messagesArray = systemPrompt 
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const model = provider === 'groq' ? this.groqModel : this.openaiModel;
    const endpoint = '/chat/completions';
    
    // Reduce max_tokens for Groq to leave more room for input
    const maxTokens = provider === 'groq' ? 600 : 800;

    try {
      const response = await this.makeRequest(endpoint, {
        model: model,
        messages: messagesArray,
        temperature: 0.7,
        max_tokens: maxTokens
      }, provider);

      return response.choices[0].message.content;
    } catch (error) {
      // Check if error is due to request being too large
      if (error.message.includes('too large') || error.message.includes('TPM') || error.message.includes('Requested')) {
        // If Groq and we have OpenAI, try OpenAI (it might handle larger requests)
        if (provider === 'groq' && this.openaiApiKey) {
          console.log('Groq request too large or rate limited, falling back to OpenAI');
          return this.chatCompletion(messages, systemPrompt, 'openai');
        }
      }
      
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
    // Check text size before processing
    if (this.isTextTooLarge(text, this.MAX_TEXT_LENGTH)) {
      throw this.skipLargeTextError(text, 'smart paste');
    }
    
    // Truncate if still too large for safe processing
    const truncatedText = this.truncateText(text, this.MAX_INPUT_LENGTH);
    
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
      { role: 'user', content: `${prompt}\n\nText:\n${truncatedText}` }
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
    // Limit query length
    const safeQuery = this.truncateText(query, 500);
    
    // Limit number of items and their length to reduce token usage
    const limitedItems = items.slice(0, this.MAX_SEARCH_ITEMS);
    
    try {
      // Try OpenAI embeddings first (Groq doesn't support embeddings)
      if (this.openaiApiKey) {
        // Limit query size for embeddings
        const queryForEmbedding = this.truncateText(safeQuery, 1000);
        const queryEmbedding = await this.generateEmbedding(queryForEmbedding, 'openai');
        
        // Calculate cosine similarity (only for items with embeddings)
        const itemsWithEmbeddings = limitedItems.filter(item => item.embedding && item.embedding.length > 0);
        if (itemsWithEmbeddings.length > 0) {
          const similarities = itemsWithEmbeddings.map(item => {
            const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
            return { item, similarity };
          });
          
          const results = similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit)
            .map(s => s.item);
          
          if (results.length > 0) {
            return results;
          }
        }
      }
    } catch (error) {
      console.log('Embedding search failed, falling back:', error.message);
    }
    
    // Fallback to keyword search or use Groq for semantic understanding
    try {
      if (this.groqApiKey && !this.isTextTooLarge(safeQuery, 500)) {
        // Limit items and their text length to reduce token usage
        const itemsForSearch = limitedItems.map((item, i) => {
          const truncatedItem = this.truncateText(item.text, this.MAX_SEARCH_ITEM_LENGTH);
          return `${i + 1}. ${truncatedItem}`;
        }).join('\n');
        
        // Estimate tokens before making request
        const prompt = `Given the query: "${safeQuery}"\n\nFind the most relevant items from this list:\n${itemsForSearch}\n\nReturn only the numbers (comma-separated) of the most relevant items, max ${limit} items.`;
        
        if (this.estimateTokens(prompt) > 2000) {
          // Too many tokens, skip Groq and use keyword search
          throw new Error('Query too large for semantic search');
        }
        
        const response = await this.chatCompletion([
          { role: 'user', content: prompt }
        ], null, 'groq');
        
        // Parse response to extract item numbers
        const numbers = response.match(/\d+/g);
        if (numbers) {
          const indices = numbers.map(n => parseInt(n) - 1).filter(i => i >= 0 && i < limitedItems.length);
          return indices.slice(0, limit).map(i => limitedItems[i]);
        }
      }
    } catch (error) {
      // If rate limited or too large, silently fall back to keyword search
      if (this.isRateLimitError(error)) {
        console.log('Groq rate limit reached, using keyword search');
      } else if (error.message.includes('too large') || error.message.includes('TPM')) {
        console.log('Query too large for semantic search, using keyword search');
      } else {
        console.log('Groq semantic search failed, using keyword search:', error.message);
      }
    }
    
    // Final fallback: keyword search (always works, no token limits)
    const queryLower = safeQuery.toLowerCase();
    return items
      .filter(item => {
        const itemText = item.text.toLowerCase();
        const words = queryLower.split(/\s+/).filter(w => w.length > 2);
        // Match if any significant word is found
        return words.length === 0 || words.some(word => itemText.includes(word));
      })
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
    // Limit message sizes
    const limitMessage = (msg) => this.truncateText(msg, this.MAX_INPUT_LENGTH);
    
    let messagesText;
    if (Array.isArray(messages)) {
      // Limit each message and total length
      const limitedMessages = messages
        .map(msg => limitMessage(msg))
        .slice(0, 5); // Max 5 messages
      messagesText = limitedMessages.map((m, i) => `Message ${i + 1}: ${m}`).join('\n\n');
    } else {
      messagesText = limitMessage(messages);
    }
    
    // Limit context
    const limitedContext = context ? this.truncateText(context, 500) : '';
    
    // Check total size before processing
    const prompt = `You are a helpful assistant. Based on the following messages, draft a concise and appropriate reply. ${limitedContext ? `Context: ${limitedContext}` : ''}\n\nMessages:\n${messagesText}\n\nDraft a reply:`;
    
    if (this.estimateTokens(prompt) > 3000) {
      throw new Error('Messages are too large. Please use shorter messages or fewer messages.');
    }

    return await this.chatCompletion([
      { role: 'user', content: prompt }
    ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
  }

  // Instant Formatter
  async formatText(text, formatType) {
    // Check text size before processing
    if (this.isTextTooLarge(text, this.MAX_TEXT_LENGTH)) {
      throw this.skipLargeTextError(text, 'formatting');
    }
    
    // Truncate if still too large
    const truncatedText = this.truncateText(text, this.MAX_INPUT_LENGTH);
    
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
      { role: 'user', content: `${prompt}${truncatedText}` }
    ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
  }

  // Auto-categorize clipboard item
  async categorizeText(text) {
    // Skip AI categorization for very large texts (use fallback)
    if (this.isTextTooLarge(text, this.MAX_CATEGORIZE_LENGTH)) {
      // Use fallback categorization for large texts
      return this.fallbackCategorize(text);
    }
    
    const categories = ['code', 'email', 'link', 'note', 'password', 'number', 'command', 'json', 'xml', 'html', 'other'];
    
    // Use only a sample of the text for categorization
    const sampleText = this.truncateText(text, this.MAX_CATEGORIZE_LENGTH);
    const prompt = `Categorize the following text into one of these categories: ${categories.join(', ')}. Return only the category name, nothing else.\n\nText: ${sampleText}`;

    try {
      const category = await this.chatCompletion([
        { role: 'user', content: prompt }
      ], null, 'groq'); // Try Groq first, will fallback to OpenAI if needed
      
      // Clean and normalize the response
      const cleanCategory = category.trim().toLowerCase();
      return categories.find(c => cleanCategory.includes(c)) || 'other';
    } catch (error) {
      // If error is due to size or rate limit, use fallback
      if (this.isRateLimitError(error) || error.message.includes('too large') || error.message.includes('TPM')) {
        return this.fallbackCategorize(text);
      }
      // For other errors, also use fallback
      return this.fallbackCategorize(text);
    }
  }
  
  // Fallback categorization (no AI needed)
  fallbackCategorize(text) {
    if (!text) return 'other';
    if (text.includes('@') && text.includes('.')) return 'email';
    if (text.startsWith('http://') || text.startsWith('https://')) return 'link';
    if (/^[0-9]+$/.test(text.trim())) return 'number';
    if (text.includes('{') || text.includes('[')) return 'json';
    if (text.includes('<') && text.includes('>')) return 'html';
    if (text.includes('function') || text.includes('const ') || text.includes('var ') || text.includes('class ')) return 'code';
    if (text.includes('<?xml') || text.includes('<xml')) return 'xml';
    if (text.startsWith('#!') || text.startsWith('sudo ') || text.startsWith('npm ') || text.startsWith('git ')) return 'command';
    return 'note';
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
