import http from 'http';

function runTest() {
  const query = "There is a CONTRADICTS edge in the graph. Please find it, read the source text from postgres, and resolve the contradiction to give me the final answer.";
  console.log(`Starting E2E RLM test with query: ${query}`);

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/rlm-stream?query=${encodeURIComponent(query)}`,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream'
    }
  }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Request failed with status code ${res.statusCode}`);
      return;
    }

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      // Chunk might contain multiple SSE messages
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.type === 'stdout') {
              process.stdout.write(data.content);
            } else if (data.type === 'stderr') {
              process.stderr.write(data.content);
            } else if (data.type === 'done') {
              console.log(`\n\n--- RLM process exited with code ${data.code} ---`);
              process.exit(data.code);
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e, 'Line:', line);
          }
        }
      }
    });

    res.on('end', () => {
      console.log('Stream ended by server.');
    });
  });

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  req.end();
}

runTest();
