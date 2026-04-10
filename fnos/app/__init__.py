import os
from flask import Flask, jsonify, request
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
    app.register_blueprint(main_bp)

    basic_auth_creds = os.environ.get('BASIC_AUTH_CREDENTIALS', '')

    @app.before_request
    def check_auth():
        if request.endpoint == 'main.api_health':
            return None

        if basic_auth_creds:
            auth = request.authorization
            if not auth or auth.username + ':' + auth.password != basic_auth_creds:
                return jsonify({'success': False, 'error': '需要认证'}), 401, {'WWW-Authenticate': 'Basic realm="ESXi VM Manager"'}

        config = app.config.get('APP_CONFIG', {})
        if not config.get('ip_whitelist_enabled', False):
            return None

        allowed, client_ip = is_ip_allowed(request, config)
        if not allowed:
            return jsonify({'success': False, 'error': '访问被拒绝: 不允许的IP地址'}), 403

    @app.before_request
    def load_config():
        from app.main import get_config
        try:
            app.config['APP_CONFIG'] = get_config()
        except:
            app.config['APP_CONFIG'] = {}

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

    from app.scheduler import init_scheduler
    init_scheduler(app)

    return app
