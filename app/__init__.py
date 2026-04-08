from flask import Flask, jsonify, request
from app.main import main_bp
from app.security import is_ip_allowed, get_client_ip

def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = 'esxi-vm-manager-secret-key'
    app.register_blueprint(main_bp)

    @app.before_request
    def check_ip_access():
        if request.endpoint == 'main.api_health':
            return None

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

    from app.scheduler import init_scheduler
    init_scheduler(app)

    return app
