"""One SSL context shared by every httpx client.

httpx builds and loads the certifi bundle for each new client unless it is given a
context, which blocks the event loop for about 16 ms per client.
"""

import httpx

# Same trust store httpx would build by default (certifi, or SSL_CERT_FILE/SSL_CERT_DIR).
SSL_CONTEXT = httpx.create_ssl_context()
