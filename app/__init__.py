import os
from flask import Flask, jsonify, request
from app.extensions import limiter
from app.main import main_bp
from app.security import is_ip_allowed, get_client_ip

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY') or 'esxi-vm-manager-secret-key'
    app.config['WTF_CSRF_ENABLED'] = False
    app.config['WTF_CSRF_CHECK_DEFAULT'] = False
    app.config['BASIC_AUTH_CREDENTIALS'] = os.environ.get('BASIC_AUTH_CREDENTIALS', '')
    app.register_blueprint(main_bp)
    limiter.init_app(app)

    @app.before_request
    def load_config_and_check_auth():
        from app.main import get_config
        try:
            app.config['APP_CONFIG'] = get_config()
        except:
            app.config['APP_CONFIG'] = {}

        if request.endpoint == 'main.health':
            return None

        basic_auth_creds = app.config.get('BASIC_AUTH_CREDENTIALS', '')
        if basic_auth_creds:
            auth = request.authorization
            if not auth or auth.username + ':' + auth.password != basic_auth_creds:
                return jsonify({'success': False, 'error': '需要认证'}), 401, {'WWW-Authenticate': 'Basic realm="ESXi VM Manager"'}

        config = app.config.get('APP_CONFIG', {})
        if not config.get('ip_whitelist_enabled', False):
            return None

        allowed, client_ip = is_ip_allowed(request, config)
        if not allowed:
            if request.path.startswith('/api/'):
                return jsonify({'success': False, 'error': '访问被拒绝: 不允许的IP地址'}), 403
            return '''
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>访问被拒绝</title>
                <style>
                    body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
                    .container { text-align: center; padding: 40px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    h1 { color: #e74c3c; margin-bottom: 20px; }
                    p { color: #666; margin: 10px 0; }
                    .ip-info { background: #fee; padding: 15px; border-radius: 5px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>⛔ 访问被拒绝</h1>
                    <p>您的 IP 地址不在允许访问的范围内</p>
                    <div class="ip-info">
                        <p><strong>您的 IP:</strong> ''' + client_ip + '''</p>
                        <p><strong>原因:</strong> IP白名单限制</p>
                    </div>
                    <p>如有疑问，请联系管理员</p>
                </div>
            </body>
            </html>
            ''', 403

    @app.errorhandler(404)
    def not_found(e):
        if request.path.startswith('/api/'):
            return jsonify({'success': False, 'error': 'API not found'}), 404
        return jsonify({'success': False, 'error': str(e)}), 404

    @app.errorhandler(500)
    def internal_error(e):
        if request.path.startswith('/api/'):
            return jsonify({'success': False, 'error': 'Internal server error'}), 500
        return jsonify({'success': False, 'error': str(e)}), 500

    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        return response

    @app.errorhandler(429)
    def ratelimit_handler(e):
        return jsonify({'success': False, 'error': '请求过于频繁，请稍后再试'}), 429

    from app.scheduler import init_scheduler
    init_scheduler(app)

    return app
