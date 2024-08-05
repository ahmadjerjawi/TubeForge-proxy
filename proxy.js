const axios = require('axios');

module.exports = async (req, res) => {
    try {
        // Extract target URL from the path
        const targetUrl = req.url.slice(1);

        if (!targetUrl) {
            return res.status(400).send({ error: 'No target URL specified' });
        }

        const decodedUrl = decodeURIComponent(targetUrl);
        const url = new URL(decodedUrl);

        // Check if the URL contains '/api/'
        if (!url.pathname.includes('/api/')) {
            return res.status(403).send({ error: 'Forbidden: URL must contain /api/' });
        }

        // Forward the request to the target URL
        const response = await axios({
            method: req.method,
            url: url.toString(),
            headers: {
                ...req.headers,
                host: url.host,
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (compatible; TubeForge/1.0)'
            },
            data: req.method === 'POST' ? req.body : undefined
        });

        // Send back the response from the target URL
        res.status(response.status).send(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            res.status(502).send({ error: 'Bad Gateway' });
        } else {
            res.status(500).send({ error: 'Internal Server Error' });
        }
    }
};
