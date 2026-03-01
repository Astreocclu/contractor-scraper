"""
HTTP utilities for faith_alpha services.

Provides rate limiting, retry with exponential backoff, and structured logging
for external API calls (SEC, FEC, LDA).
"""
import logging
import time
from functools import wraps
from typing import Any, Callable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


class RateLimiter:
    """
    Token bucket rate limiter for API calls.

    SEC EDGAR: 10 requests/second
    FEC: 1000 requests/hour (≈0.28/sec, but we use 1/sec to be safe)
    LDA: No documented limit, use conservative 2/sec
    """

    # Requests per second for each API
    RATE_LIMITS = {
        'sec': 10.0,      # SEC allows 10/sec
        'fec': 1.0,       # FEC is hourly, be conservative
        'lda': 2.0,       # LDA undocumented, be conservative
        'default': 5.0,   # Default fallback
    }

    def __init__(self):
        self._last_request: dict[str, float] = {}

    def wait(self, api_name: str = 'default') -> None:
        """Wait if needed to respect rate limit."""
        rate = self.RATE_LIMITS.get(api_name, self.RATE_LIMITS['default'])
        min_interval = 1.0 / rate

        now = time.monotonic()
        last = self._last_request.get(api_name, 0)
        elapsed = now - last

        if elapsed < min_interval:
            sleep_time = min_interval - elapsed
            logger.debug('Rate limiting %s: sleeping %.3fs', api_name, sleep_time)
            time.sleep(sleep_time)

        self._last_request[api_name] = time.monotonic()


# Global rate limiter instance
_rate_limiter = RateLimiter()


def get_retry_session(
    retries: int = 3,
    backoff_factor: float = 0.5,
    status_forcelist: tuple = (429, 500, 502, 503, 504),
) -> requests.Session:
    """
    Create a requests Session with retry logic.

    Args:
        retries: Number of retries for failed requests
        backoff_factor: Exponential backoff multiplier (0.5 = 0.5s, 1s, 2s)
        status_forcelist: HTTP status codes to retry on

    Returns:
        Configured requests.Session
    """
    session = requests.Session()

    retry_strategy = Retry(
        total=retries,
        backoff_factor=backoff_factor,
        status_forcelist=status_forcelist,
        allowed_methods=['GET', 'POST'],
        raise_on_status=False,
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount('https://', adapter)
    session.mount('http://', adapter)

    return session


def rate_limited_request(
    api_name: str,
    method: str = 'GET',
    url: str = '',
    session: requests.Session | None = None,
    timeout: int = 30,
    max_retries: int = 3,
    **kwargs,
) -> requests.Response:
    """
    Make a rate-limited HTTP request with retry logic.

    Args:
        api_name: API identifier for rate limiting ('sec', 'fec', 'lda')
        method: HTTP method
        url: Request URL
        session: Optional requests.Session (creates one if not provided)
        timeout: Request timeout in seconds
        max_retries: Maximum retry attempts for transient errors
        **kwargs: Additional arguments passed to requests

    Returns:
        requests.Response

    Raises:
        requests.RequestException: On persistent failure
    """
    if session is None:
        session = get_retry_session()

    last_error = None

    for attempt in range(max_retries + 1):
        # Rate limit before each attempt
        _rate_limiter.wait(api_name)

        try:
            logger.debug(
                '[%s] %s %s (attempt %d/%d)',
                api_name.upper(), method, url, attempt + 1, max_retries + 1
            )

            response = session.request(
                method=method,
                url=url,
                timeout=timeout,
                **kwargs,
            )

            # Check for rate limit response
            if response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', 5))
                logger.warning(
                    '[%s] Rate limited (429), waiting %ds before retry',
                    api_name.upper(), retry_after
                )
                time.sleep(retry_after)
                continue

            # Log response status
            if response.ok:
                logger.debug(
                    '[%s] %s %s -> %d (%d bytes)',
                    api_name.upper(), method, url,
                    response.status_code, len(response.content)
                )
            else:
                logger.warning(
                    '[%s] %s %s -> %d: %s',
                    api_name.upper(), method, url,
                    response.status_code, response.text[:200]
                )

            return response

        except requests.exceptions.Timeout as e:
            last_error = e
            wait_time = (2 ** attempt) * 0.5
            logger.warning(
                '[%s] Timeout on attempt %d/%d, waiting %.1fs: %s',
                api_name.upper(), attempt + 1, max_retries + 1, wait_time, e
            )
            time.sleep(wait_time)

        except requests.exceptions.ConnectionError as e:
            last_error = e
            wait_time = (2 ** attempt) * 0.5
            logger.warning(
                '[%s] Connection error on attempt %d/%d, waiting %.1fs: %s',
                api_name.upper(), attempt + 1, max_retries + 1, wait_time, e
            )
            time.sleep(wait_time)

        except requests.exceptions.RequestException as e:
            last_error = e
            logger.error('[%s] Request failed: %s', api_name.upper(), e)
            raise

    # All retries exhausted
    logger.error(
        '[%s] All %d retries exhausted for %s',
        api_name.upper(), max_retries + 1, url
    )
    raise last_error or requests.exceptions.RequestException(
        f'All retries exhausted for {url}'
    )


def rate_limited_json(
    api_name: str,
    url: str,
    session: requests.Session | None = None,
    timeout: int = 30,
    max_retries: int = 3,
    **kwargs,
) -> dict[str, Any]:
    """
    Make a rate-limited GET request and parse JSON response.

    Args:
        api_name: API identifier for rate limiting
        url: Request URL
        session: Optional requests.Session
        timeout: Request timeout in seconds
        max_retries: Maximum retry attempts
        **kwargs: Additional arguments (headers, params, etc.)

    Returns:
        Parsed JSON as dict

    Raises:
        requests.RequestException: On request failure
        ValueError: On JSON parse failure
    """
    response = rate_limited_request(
        api_name=api_name,
        method='GET',
        url=url,
        session=session,
        timeout=timeout,
        max_retries=max_retries,
        **kwargs,
    )
    response.raise_for_status()
    return response.json()


def with_progress(
    items: list,
    desc: str = 'Processing',
    log_every: int = 10,
) -> Callable:
    """
    Decorator/context for logging progress on batch operations.

    Args:
        items: List of items being processed
        desc: Description for logging
        log_every: Log progress every N items
    """
    total = len(items)

    def log_progress(index: int, item: Any = None):
        if index % log_every == 0 or index == total - 1:
            pct = ((index + 1) / total) * 100 if total > 0 else 100
            logger.info('%s: %d/%d (%.1f%%)', desc, index + 1, total, pct)

    return log_progress
