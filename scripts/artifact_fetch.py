"""Developer artifact retrieval with verified Windows TLS fallback."""
import urllib.request
import urllib.error
import ssl
import os
import sys
import subprocess
from pathlib import Path

def fetch_bytes(url, timeout=90):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.read()
    except urllib.error.URLError as error:
        # Portable Python may miss an intermediate certificate that Windows Schannel resolves.
        # Use the OS HTTPS client with its normal certificate verification, retaining file hashes.
        curl = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32' / 'curl.exe'
        if sys.platform != 'win32' or not isinstance(error.reason, ssl.SSLError) or not curl.is_file():
            raise
        result = subprocess.run([str(curl), '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', str(timeout), url], capture_output=True, check=True)
        return result.stdout

