const https = require('https');

const apiKey = '1da327ecf7f11f83885d70dc2637bd5dec2f9426';

function search(query) {
    const data = JSON.stringify({
        q: query
    });

    const options = {
        hostname: 'google.serper.dev',
        path: '/search',
        method: 'POST',
        headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
            body += chunk;
        });

        res.on('end', () => {
            console.log('Status Code:', res.statusCode);
            try {
                const json = JSON.parse(body);
                console.log('Results Found:', json.organic ? json.organic.length : 0);
                if (json.organic && json.organic.length > 0) {
                    console.log('First Result:', json.organic[0].title);
                    console.log('Snippet:', json.organic[0].snippet);
                }
            } catch (e) {
                console.log('Error parsing JSON:', e.message);
                console.log('Body:', body);
            }
        });
    });

    req.on('error', (e) => {
        console.error('Request Error:', e);
    });

    req.write(data);
    req.end();
}

console.log('Testing Serper API with: site:dallascounty.org "SunRoom Season" civil');
search('site:dallascounty.org "SunRoom Season" civil');
