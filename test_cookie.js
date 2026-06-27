const https = require('https');

function fetchCookieAndQuery() {
  console.log('Step 1: Getting session cookie from domainchecker.php...');
  const options = {
    hostname: 'www.quyu.net',
    path: '/domainchecker.php',
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    }
  };

  const req = https.request(options, (res) => {
    const cookies = res.headers['set-cookie'] || [];
    console.log('Received cookies:', cookies);

    // Extract cookies
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
    console.log('Formatted Cookie Header:', cookieHeader);

    if (!cookieHeader) {
      console.error('Failed to get cookies!');
      return;
    }

    // Step 2: Send WHOIS query
    console.log('\nStep 2: Sending initial WHOIS query...');
    const postData = 'domain=testavailable12345.com,baidu.com&ajax=1';

    const queryOptions = {
      hostname: 'www.quyu.net',
      path: '/whois2.php',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Referer': 'https://www.quyu.net/domainchecker.php',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': cookieHeader,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const queryReq = https.request(queryOptions, (queryRes) => {
      let data = '';
      queryRes.on('data', chunk => data += chunk);
      queryRes.on('end', () => {
        console.log('Query Response Status:', queryRes.statusCode);
        console.log('Query Response Headers:', queryRes.headers);
        console.log('Query Response Body:', data);

        // Step 3: Polling wait
        console.log('\nStep 3: Polling for results after 1s...');
        setTimeout(() => {
          const pollData = 'domain=testavailable12345.com&ajax=1&wait=wait';
          const pollOptions = {
            ...queryOptions,
            headers: {
              ...queryOptions.headers,
              'Content-Length': Buffer.byteLength(pollData)
            }
          };

          const pollReq = https.request(pollOptions, (pollRes) => {
            let pollDataRes = '';
            pollRes.on('data', chunk => pollDataRes += chunk);
            pollRes.on('end', () => {
              console.log('Poll Response Status:', pollRes.statusCode);
              console.log('Poll Response Body:', pollDataRes);
            });
          });
          pollReq.write(pollData);
          pollReq.end();
        }, 1000);
      });
    });

    queryReq.write(postData);
    queryReq.end();
  });

  req.end();
}

fetchCookieAndQuery();
