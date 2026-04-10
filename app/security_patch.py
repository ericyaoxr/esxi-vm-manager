"""
安全修复补丁 - 需要安装: pip install cryptography
"""
from functools import wraps
from flask import request, jsonify
import ipaddress

# ========== 1. 密码加密 ==========
from cryptography.fernet import Fernet
import os

ENCRYPTION_KEY = os.environ.get('VM_MANAGER_KEY') or Fernet.generate_key()
_fernet = Fernet(ENCRYPTION_KEY if isinstance(ENCRYPTION_KEY, bytes) else ENCRYPTION_KEY.encode())

def encrypt_password(password):
    return _fernet.encrypt(password.encode()).decode()

def decrypt_password(encrypted):
    return _fernet.decrypt(encrypted.encode()).decode()

# ========== 2. API 认证 ==========
API_KEYS = set(os.environ.get('API_KEYS', '').split(',')) - {''}

def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-API-Key')
        if key not in API_KEYS:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

# ========== 3. SSRF 防护 ==========
ALLOWED_NETWORKS = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12']

def validate_target_host(host):
    try:
        target_ip = ipaddress.ip_address(host)
        for network in ALLOWED_NETWORKS:
            if target_ip in ipaddress.ip_network(network):
                return True
        return False
    except:
        return False

# ========== 4. CORS 限制 ==========
ALLOWED_ORIGINS = set(os.environ.get('ALLOWED_ORIGINS', '').split(',')) - {''}

# ========== 5. 安全头部 ==========
SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000',
}

def add_security_headers(response):
    for header, value in SECURITY_HEADERS.items():
        response.headers[header] = value
    origin = request.headers.get('Origin')
    if origin in ALLOWED_ORIGINS:
        response.headers['Access-Control-Allow-Origin'] = origin
    return response
