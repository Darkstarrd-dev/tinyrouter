// pg-search.js
var PG_SEARCH_CLASSIFY_PROMPT = 'You are a search query classifier. Given a user\'s search query, determine the best search strategy.\n\nAvailable domains: general, resource, social_media, finance, academic, legal, health, business, security, ip, code, energy, environment, agriculture, travel, film, gaming\n\nRules:\n- If the query is about a specific domain (e.g. stock prices, academic papers, legal cases), use "vertical" strategy with the appropriate domain.\n- If the query is general knowledge or you are unsure, use "general" strategy.\n- For vertical search, identify the most specific sub_domain if possible.\n\nRespond with ONLY a JSON object (no markdown fences, no explanation):\n{"strategy":"general"|"vertical","domain":"<domain_name>"|null,"sub_domain":"<sub_domain>"|null,"sub_domain_params":{}|null,"query":"<refined search query>"}';

var PG_SEARCH_SYNTHESIZE_PROMPT = 'You are a search result synthesizer. Given a user\'s original query and raw search results from a search engine, provide a comprehensive, well-formatted Markdown summary that answers the user\'s question. Include relevant details, organize information with headers/lists/tables as appropriate, and mention sources where available. Write in the same language as the user\'s query.';

function pgSearchSend(query) {
  var w = pgWinAt(0);
  if (!w) return;
  var now = Date.now();
  w.messages.push({ role: 'user', content: query, createdAt: now });
  w.messages.push({ role: 'assistant', content: '', status: 'loading', startedAt: now, searchStep: 'classifying' });
  w.streaming = true;
  w.abortCtrl = new AbortController();
  pgRenderMessages(0);
  pgUpdateInputBar();

  // Step 1: Classify query
  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TinyRouter-Source': 'playground' },
    body: JSON.stringify({
      model: w.config.model,
      messages: [
        { role: 'system', content: PG_SEARCH_CLASSIFY_PROMPT },
        { role: 'user', content: query }
      ],
      stream: false
    }),
    signal: w.abortCtrl.signal,
  }).then(function(resp) {
    if (!resp.ok) {
      return resp.text().then(function(text) {
        throw new Error('Classify HTTP ' + resp.status + ': ' + text);
      });
    }
    return resp.json();
  }).then(function(data) {
    var w2 = pgWinAt(0);
    var msg = w2.messages[w2.messages.length - 1];
    if (!msg || msg.status === 'error') return;
    var classifyText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    var classification = null;
    try {
      var cleaned = classifyText.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
      classification = JSON.parse(cleaned);
    } catch (e) {
      // Fallback to general
    }
    if (!classification || typeof classification !== 'object' || !classification.strategy) {
      classification = { strategy: 'general', domain: null, sub_domain: null, sub_domain_params: null, query: query };
    }
    msg.searchClassification = classification;
    msg.searchStep = 'searching';
    pgRenderBubble(0, w2.messages.length - 1);

    // Step 2: Search
    return fetch('/api/anysearch/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: classification.query,
        domain: classification.domain,
        sub_domain: classification.sub_domain,
        sub_domain_params: classification.sub_domain_params,
        max_results: pgState.search.maxResults
      }),
      signal: w2.abortCtrl.signal,
    }).then(function(resp2) {
      if (!resp2.ok) {
        return resp2.text().then(function(text) {
          throw new Error('Search HTTP ' + resp2.status + ': ' + text);
        });
      }
      return resp2.json();
    }).then(function(searchData) {
      var w3 = pgWinAt(0);
      var msg2 = w3.messages[w3.messages.length - 1];
      if (!msg2 || msg2.status === 'error') return;
      if (searchData.error) throw new Error(searchData.error);
      var rawResult = searchData.result || '';
      if (!rawResult) throw new Error('Empty search results');
      msg2.searchRaw = rawResult;
      msg2.searchStep = 'synthesizing';
      msg2.status = 'streaming';
      w3.pendingContent = '';
      pgRenderBubble(0, w3.messages.length - 1);

      // Step 3: Synthesize (streaming)
      var synthBody = {
        model: w3.config.model,
        messages: [
          { role: 'system', content: PG_SEARCH_SYNTHESIZE_PROMPT },
          { role: 'user', content: 'Query: ' + query + '\n\nSearch Results:\n' + rawResult }
        ],
        stream: true
      };
      return fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'X-TinyRouter-Source': 'playground' },
        body: JSON.stringify(synthBody),
        signal: w3.abortCtrl.signal,
      }).then(function(resp3) {
        if (!resp3.ok || !resp3.body) {
          return resp3.text().then(function(text) {
            throw new Error('Synthesize HTTP ' + resp3.status + ': ' + text);
          });
        }
        var reader = resp3.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        function pump() {
          return reader.read().then(function(chunk) {
            if (chunk.done) {
              pgSearchFinish();
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            var events = buffer.split('\n');
            buffer = events.pop();
            for (var j = 0; j < events.length; j++) {
              var line = events[j].trim();
              if (!line) continue;
              var data = pgParseSSELine(line);
              if (!data) continue;
              if (data.done) {
                pgSearchFinish();
                return;
              }
              pgSearchApplyChunk(data);
            }
            pgSearchFlushRender();
            return pump();
          });
        }
        return pump();
      });
    });
  }).catch(function(err) {
    if (err && err.name === 'AbortError') {
      pgSearchFinish();
    } else {
      pgSearchFail(err && err.message ? err.message : String(err));
    }
  });
}

function pgSearchApplyChunk(data) {
  var w = pgWinAt(0);
  var choices = data.choices;
  if (!choices || !choices.length) return;
  var delta = choices[0].delta || {};
  if (delta.content) w.pendingContent = pgMergeChunk(w.pendingContent, delta.content);
}

function pgSearchFlushRender() {
  var w = pgWinAt(0);
  if (w.renderTimer) return;
  w.renderTimer = setTimeout(function() {
    var w2 = pgWinAt(0);
    w2.renderTimer = null;
    if (!w2.streaming) return;
    var msg = w2.messages[w2.messages.length - 1];
    if (!msg) return;
    msg.content = w2.pendingContent;
    msg.status = 'streaming';
    pgRenderBubble(0, w2.messages.length - 1);
    pgScrollBottom(0, w2.messages.length - 1);
  }, 50);
}

function pgSearchFinish() {
  var w = pgWinAt(0);
  if (!w.streaming) return;
  w.streaming = false;
  if (w.renderTimer) { clearTimeout(w.renderTimer); w.renderTimer = null; }
  w.abortCtrl = null;
  var msg = w.messages[w.messages.length - 1];
  if (msg) {
    msg.content = w.pendingContent || msg.content;
    msg.status = 'complete';
    msg.searchStep = 'done';
    if (!msg.completedAt) {
      msg.completedAt = Date.now();
      if (msg.startedAt) msg.durationMs = msg.completedAt - msg.startedAt;
    }
  }
  w.pendingContent = '';
  pgRenderBubble(0, w.messages.length - 1);
  pgRenderDebug();
  pgSave();
  pgUpdateInputBar();
}

function pgSearchFail(errMsg) {
  var w = pgWinAt(0);
  w.streaming = false;
  if (w.renderTimer) { clearTimeout(w.renderTimer); w.renderTimer = null; }
  w.abortCtrl = null;
  var msg = w.messages[w.messages.length - 1];
  if (msg) {
    msg.error = errMsg;
    msg.status = 'error';
    msg.searchStep = 'error';
    if (!msg.completedAt) {
      msg.completedAt = Date.now();
      if (msg.startedAt) msg.durationMs = msg.completedAt - msg.startedAt;
    }
  }
  pgRenderBubble(0, w.messages.length - 1);
  pgRenderDebug();
  pgUpdateInputBar();
}

function pgSearchSaveKey() {
  var input = document.getElementById('pg-search-key-input');
  if (!input) return;
  var key = input.value.trim();
  pgApiPatch('/settings', { anySearch: { apiKey: key } }).then(function() {
    pgState.search.apiKey = key;
    pgToast(pgT('pgSearchKeySaved'), 'success');
  }).catch(function() {
    pgToast(pgT('pgSearchError'), 'error');
  });
}

function pgSearchLoadSettings() {
  pgApiGet('/settings').then(function(res) {
    if (res && res.anySearch) {
      pgState.search.apiKey = res.anySearch.apiKey || '';
      pgState.search.maxResults = res.anySearch.maxResults || 5;
      var keyInput = document.getElementById('pg-search-key-input');
      if (keyInput) keyInput.value = pgState.search.apiKey;
      var slider = document.getElementById('pg-search-slider');
      if (slider) {
        slider.value = pgState.search.maxResults;
        var val = document.getElementById('pg-search-slider-val');
        if (val) val.textContent = pgState.search.maxResults;
      }
    }
  }).catch(function() {});
}

function pgRenderSearchSettings(cfg) {
  var keyVal = pgState.search.apiKey || '';
  var maxVal = pgState.search.maxResults || 5;
  return '<div class="pg-search-settings">' +
    '<div class="pg-search-key-row">' +
      '<input type="password" class="pg-search-key-input" id="pg-search-key-input" value="' + pgEscapeHtml(keyVal) + '" placeholder="' + pgEscapeHtml(pgT('pgSearchApiKeyHint')) + '">' +
      '<button class="pg-search-save-btn" onclick="pgSearchSaveKey()">' + pgEscapeHtml(pgT('pgSearchSaveKey')) + '</button>' +
    '</div>' +
    '<div class="pg-search-slider-row">' +
      '<span>' + pgEscapeHtml(pgT('pgSearchMaxResults')) + '</span>' +
      '<input type="range" class="pg-search-slider" id="pg-search-slider" min="1" max="10" value="' + maxVal + '" onchange="pgSearchSliderChange(this.value)">' +
      '<span class="pg-search-slider-val" id="pg-search-slider-val">' + maxVal + '</span>' +
    '</div>' +
  '</div>';
}

function pgSearchSliderChange(val) {
  pgState.search.maxResults = parseInt(val, 10);
  var valEl = document.getElementById('pg-search-slider-val');
  if (valEl) valEl.textContent = val;
  pgApiPatch('/settings', { anySearch: { maxResults: pgState.search.maxResults } }).catch(function() {});
}