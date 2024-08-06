const axios = require('axios');
const express = require('express');
const cheerio = require('cheerio');
const zlib = require('zlib');
const app = express();

app.use(express.json());

function rewriteUrls(content, baseUrl, contentType) {
    if (contentType && contentType.includes('text/html')) {
        const $ = cheerio.load(content);
        $('script[src], link[href], img[src], a[href], form[action]').each((_, element) => {
            const srcAttr = $(element).attr('src');
            const hrefAttr = $(element).attr('href');
            const actionAttr = $(element).attr('action');

            const fixUrl = (url) => {
                if (url && !/^https?:\/\//i.test(url)) {
                    return new URL(url, baseUrl).href;
                }
                return url;
            };

            if (srcAttr) {
                $(element).attr('src', fixUrl(srcAttr));
            }
            if (hrefAttr) {
                $(element).attr('href', fixUrl(hrefAttr));
            }
            if (actionAttr) {
                $(element).attr('action', fixUrl(actionAttr));
            }
        });
        return $.html();
    } else if (contentType && contentType.includes('application/javascript')) {
        // For JavaScript content, replace URLs directly
        let updatedContent = content.toString('utf8');
        const baseUrl = new URL(baseUrl).origin;
        updatedContent = updatedContent.replace(/(src|href|url)\s*=\s*['"]([^'"]+)['"]/g, (match, p1, p2) => {
            if (!/^https?:\/\//i.test(p2)) {
                const fixedUrl = new URL(p2, baseUrl).href;
                return `${p1}="${fixedUrl}"`;
            }
            return match;
        });
        return updatedContent;
    }
    return content;
}

async function proxyHandler(req, res) {
    try {
        const targetUrl = req.url.slice(1);
        const decodedUrl = decodeURIComponent(targetUrl);

        let finalUrl;
        if (/^https?:\/\//i.test(decodedUrl)) {
            finalUrl = decodedUrl;
        } else {
            finalUrl = `https://${decodedUrl}`;
        }

        console.log(`Proxying request to: ${finalUrl}`);

        const response = await axios({
            method: req.method,
            url: finalUrl,
            headers: {
                ...req.headers,
                host: new URL(finalUrl).host,
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (compatible; ProxyServer/1.0)'
            },
            data: req.method === 'POST' ? req.body : undefined,
            responseType: 'arraybuffer',
            validateStatus: null,
            maxRedirects: 0,
        });

        console.log(`Received response with status: ${response.status}`);

        // Handle CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (response.status === 302 || response.status === 301) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
                const absoluteRedirectUrl = new URL(redirectUrl, finalUrl).toString();
                const proxyRedirectUrl = absoluteRedirectUrl.replace(/^https?:\/\//, '/');
                console.log(`Redirecting to: ${proxyRedirectUrl}`);
                res.redirect(proxyRedirectUrl);
                return;
            }
        }

        const contentType = response.headers['content-type'];

        if (contentType && (contentType.includes('text/html') || contentType.includes('application/javascript'))) {
            const encoding = response.headers['content-encoding'];
            let content = response.data;

            if (encoding && encoding.includes('gzip')) {
                content = zlib.gunzipSync(response.data);
            }

            const baseUrl = `https://${new URL(finalUrl).host}`;
            const modifiedContent = rewriteUrls(content, baseUrl, contentType);
            res.set('Content-Type', contentType);
            res.status(response.status).send(modifiedContent);
        } else {
            res.set('Content-Type', contentType);
            res.status(response.status).send(response.data);
        }
    } catch (error) {
        console.error('Proxy error:', error.message);
        if (error.response) {
            console.error('Response error status:', error.response.status);
            res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
            console.error('No response received');
            res.status(502).send({ error: 'Bad Gateway' });
        } else {
            console.error('Request setup error');
            res.status(500).send({ error: 'Internal Server Error' });
        }
    }
}

app.all('/*', proxyHandler);
