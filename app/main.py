import os
import json
import ssl
import time
from datetime import datetime
from flask import Blueprint, render_template, jsonify, request

from pyVim import connect
from pyVmomi import vim

main_bp = Blueprint('main', __name__)

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'esxi-vm-manager-secret-key'
    CONFIG_PATH = os.environ.get('CONFIG_PATH') or os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'config.json')
    LOG_PATH = os.environ.get('LOG_PATH') or os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs')
    FAVORITES_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'favorites.json')
    SERVERS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'servers.json')

def get_config():
    try:
        with open(Config.CONFIG_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        return {"error": str(e)}

def save_config(data):
    try:
        config_dir = os.path.dirname(Config.CONFIG_PATH)
        os.makedirs(config_dir, exist_ok=True)
        with open(Config.CONFIG_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        return str(e)

def write_log(message, level="INFO"):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"{timestamp} [{level}] {message}"
    print(log_entry)

    log_file = os.path.join(Config.LOG_PATH, f"{datetime.now().strftime('%Y%m%d')}-web.log")
    try:
        log_dir = os.path.dirname(log_file)
        os.makedirs(log_dir, exist_ok=True)
        with open(log_file, 'a') as f:
            f.write(log_entry + '\n')
    except:
        pass

def load_servers():
    try:
        if os.path.exists(Config.SERVERS_PATH):
            with open(Config.SERVERS_PATH, 'r') as f:
                return json.load(f)
        return []
    except:
        return []

def save_servers(servers):
    try:
        servers_dir = os.path.dirname(Config.SERVERS_PATH)
        os.makedirs(servers_dir, exist_ok=True)
        with open(Config.SERVERS_PATH, 'w') as f:
            json.dump(servers, f, indent=2)
        return True
    except Exception as e:
        return str(e)

def get_favorites():
    try:
        if os.path.exists(Config.FAVORITES_PATH):
            with open(Config.FAVORITES_PATH, 'r') as f:
                return json.load(f)
        return []
    except:
        return []

def save_favorites(favorites):
    try:
        fav_dir = os.path.dirname(Config.FAVORITES_PATH)
        os.makedirs(fav_dir, exist_ok=True)
        with open(Config.FAVORITES_PATH, 'w') as f:
            json.dump(favorites, f, indent=2)
        return True
    except Exception as e:
        return str(e)

def get_ssl_context():
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context

def connect_to_vsphere(server=None):
    if server:
        creds = server
    else:
        creds = load_servers()[0] if load_servers() else {}

    if not creds or not creds.get('host'):
        return None, "No credentials configured"

    try:
        context = get_ssl_context()
        service_instance = connect.SmartConnect(
            host=creds['host'],
            user=creds['username'],
            pwd=creds['password'],
            sslContext=context
        )
        return service_instance, None
    except Exception as e:
        return None, str(e)

def get_vm_state_from_vm(vm_obj):
    state_map = {
        'poweredOn': 'poweredOn',
        'poweredOff': 'poweredOff',
        'suspended': 'suspended'
    }
    return state_map.get(vm_obj.runtime.powerState, 'Unknown')

def get_all_vms_from_vsphere(server=None):
    service_instance, error = connect_to_vsphere(server)
    if error:
        return [], error

    vms = []
    server_name = server.get('name', 'Unknown') if server else 'Default'
    try:
        content = service_instance.RetrieveContent()
        container = content.rootFolder
        view_type = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, view_type, recursive)

        for vm in containerView.view:
            vm_summary = vm.summary
            vms.append({
                'name': vm.name,
                'state': get_vm_state_from_vm(vm),
                'uuid': vm_summary.config.uuid,
                'server': server_name,
                'server_host': server.get('host', '') if server else '',
                'cpu': vm_summary.config.numCpu,
                'memory': int(vm_summary.config.memorySizeMB / 1024)
            })

        connect.Disconnect(service_instance)
    except Exception as e:
        return [], str(e)

    return vms, None

def vm_action_by_name(vm_name, action, server=None):
    service_instance, error = connect_to_vsphere(server)
    if error:
        return False, error

    try:
        content = service_instance.RetrieveContent()
        container = content.rootFolder
        view_type = [vim.VirtualMachine]
        recursive = True
        containerView = content.viewManager.CreateContainerView(container, view_type, recursive)

        vm_obj = None
        for vm in containerView.view:
            if vm.name == vm_name:
                vm_obj = vm
                break

        if not vm_obj:
            connect.Disconnect(service_instance)
            return False, f"VM {vm_name} not found"

        if action == 'start':
            if vm_obj.runtime.powerState != vim.VirtualMachinePowerState.poweredOn:
                task = vm_obj.PowerOn()
                wait_for_task(task)
            result = True
        elif action == 'stop' or action == 'shutdown':
            if vm_obj.runtime.powerState == vim.VirtualMachinePowerState.poweredOn:
                task = vm_obj.PowerOff()
                wait_for_task(task)
            result = True
        elif action == 'suspend':
            if vm_obj.runtime.powerState == vim.VirtualMachinePowerState.poweredOn:
                task = vm_obj.Suspend()
                wait_for_task(task)
            result = True
        elif action == 'restart':
            if vm_obj.runtime.powerState == vim.VirtualMachinePowerState.poweredOn:
                task = vm_obj.Reset()
                wait_for_task(task)
            result = True
        else:
            result = False

        connect.Disconnect(service_instance)
        return result, None

    except Exception as e:
        try:
            connect.Disconnect(service_instance)
        except:
            pass
        return False, str(e)

def wait_for_task(task):
    while True:
        if task.info.state == vim.TaskInfo.State.success:
            return True
        elif task.info.state == vim.TaskInfo.State.error:
            return False
        time.sleep(0.5)

@main_bp.route('/')
def index():
    return render_template('index.html')

@main_bp.route('/api/config', methods=['GET'])
def api_get_config():
    config = get_config()
    if 'error' in config:
        return jsonify({'success': False, 'error': config['error']}), 500
    return jsonify({'success': True, 'config': config})

@main_bp.route('/api/config', methods=['POST'])
def api_save_config():
    data = request.json
    result = save_config(data)
    if result is True:
        write_log("Configuration saved")
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': result})

@main_bp.route('/api/servers', methods=['GET'])
def api_get_servers():
    servers = load_servers()
    return jsonify({'success': True, 'servers': servers})

@main_bp.route('/api/servers', methods=['POST'])
def api_save_servers():
    data = request.json
    servers = data.get('servers', [])
    result = save_servers(servers)
    if result is True:
        write_log(f"Servers updated: {len(servers)} servers")
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': result})

@main_bp.route('/api/servers/check', methods=['POST'])
def api_check_server():
    data = request.json
    server = data.get('server', {})

    service_instance, error = connect_to_vsphere(server)
    if error:
        return jsonify({'success': False, 'error': error})

    try:
        about = service_instance.content.about
        connect.Disconnect(service_instance)
        return jsonify({
            'success': True,
            'info': {
                'name': about.name,
                'vendor': about.vendor,
                'version': about.version,
                'build': about.build
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/vms', methods=['GET'])
def api_list_vms():
    servers = load_servers()
    all_vms = []
    errors = []

    for server in servers:
        vms, error = get_all_vms_from_vsphere(server)
        if error:
            errors.append(f"{server.get('name', server.get('host'))}: {error}")
        else:
            all_vms.extend(vms)

    if not all_vms and errors:
        return jsonify({'success': False, 'error': '; '.join(errors), 'vms': []})

    return jsonify({'success': True, 'vms': all_vms, 'errors': errors if errors else None})

@main_bp.route('/api/favorites', methods=['GET'])
def api_get_favorites():
    favorites = get_favorites()
    return jsonify({'success': True, 'favorites': favorites})

@main_bp.route('/api/favorites', methods=['POST'])
def api_save_favorites():
    data = request.json
    favorites = data.get('favorites', [])
    result = save_favorites(favorites)
    if result is True:
        write_log(f"Favorites saved: {favorites}")
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': result})

@main_bp.route('/api/vm/<action>', methods=['POST'])
def api_vm_action(action):
    data = request.json
    vm_name = data.get('name')
    server_host = data.get('server_host', '')

    servers = load_servers()
    server = next((s for s in servers if s.get('host') == server_host), servers[0] if servers else None)

    if vm_name:
        write_log(f"Executing action '{action}' on VM: {vm_name}")
        success, error = vm_action_by_name(vm_name, action, server)

        if success:
            write_log(f"Success: {action} {vm_name}")
            return jsonify({'success': True, 'message': f'VM {vm_name} {action} successful'})
        else:
            write_log(f"Failed: {action} {vm_name} - {error}", "ERROR")
            return jsonify({'success': False, 'error': error})
    else:
        return jsonify({'success': False, 'error': 'VM name required'})

@main_bp.route('/api/batch-vm-action', methods=['POST'])
def api_batch_vm_action():
    data = request.json
    vm_list = data.get('vms', [])

    if not vm_list:
        return jsonify({'success': False, 'error': 'No VMs specified'})

    servers = load_servers()
    delay = int(data.get('delay', 0))

    results = []
    for vm_info in vm_list:
        vm_name = vm_info.get('name')
        server_host = vm_info.get('server_host', '')
        action = vm_info.get('action', '')

        if not vm_name or not action:
            continue

        server = next((s for s in servers if s.get('host') == server_host), servers[0] if servers else None)

        write_log(f"Executing batch action '{action}' on VM: {vm_name}")
        success, error = vm_action_by_name(vm_name, action, server)

        if success:
            results.append({'name': vm_name, 'server': server_host, 'action': 'success'})
            write_log(f"Success: {action} {vm_name}")
        else:
            results.append({'name': vm_name, 'server': server_host, 'action': 'failed', 'error': error})
            write_log(f"Failed: {action} {vm_name} - {error}", "ERROR")

        if delay > 0 and vm_info != vm_list[-1]:
            time.sleep(delay)

    success_count = sum(1 for r in results if r['action'] == 'success')
    failed_count = sum(1 for r in results if r['action'] == 'failed')

    write_log(f"Batch action completed: Success={success_count}, Failed={failed_count}")
    return jsonify({
        'success': True,
        'results': results,
        'summary': {
            'success': success_count,
            'failed': failed_count
        }
    })

@main_bp.route('/api/status', methods=['GET'])
def api_status():
    servers = load_servers()

    if not servers:
        return jsonify({
            'success': True,
            'connected': False,
            'error': 'No servers configured'
        })

    connected_servers = []
    errors = []

    for server in servers:
        service_instance, error = connect_to_vsphere(server)
        if error:
            errors.append({'server': server.get('name', server.get('host')), 'error': error})
            continue

        try:
            about = service_instance.content.about
            connected_servers.append({
                'name': server.get('name', about.name),
                'host': server.get('host'),
                'vendor': about.vendor,
                'version': about.version,
                'build': about.build
            })
            connect.Disconnect(service_instance)
        except Exception as e:
            errors.append({'server': server.get('name', server.get('host')), 'error': str(e)})

    return jsonify({
        'success': True,
        'connected': len(connected_servers) > 0,
        'servers': connected_servers,
        'errors': errors if errors else None
    })

@main_bp.route('/api/servers/detail', methods=['GET'])
def api_servers_detail():
    servers = load_servers()
    detailed_servers = []

    for server in servers:
        service_instance, error = connect_to_vsphere(server)
        if error:
            detailed_servers.append({
                'name': server.get('name', server.get('host')),
                'host': server.get('host'),
                'connected': False,
                'error': error
            })
            continue

        try:
            content = service_instance.RetrieveContent()
            about = content.about

            perf_manager = content.perfManager
            host_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
            host_system = host_view.view[0]

            cpu_usage = 0
            memory_usage = 0
            memory_total = 0
            memory_free = 0
            disk_info = []

            server_model = getattr(host_system.hardware.systemInfo, 'model', 'N/A')
            server_vendor = getattr(host_system.hardware.systemInfo, 'vendor', 'N/A')

            if host_system.hardware.cpuInfo:
                cpu_count = host_system.hardware.cpuInfo.numCpuThreads
                cpu_cores = host_system.hardware.cpuInfo.numCpuCores
                cpu_usage = host_system.summary.quickStats.overallCpuUsage
                cpu_speed_mhz = host_system.hardware.cpuInfo.hz / 1000000
                cpu_total_mhz = cpu_count * cpu_speed_mhz
                cpu_usage_percent = (cpu_usage / cpu_total_mhz * 100) if cpu_total_mhz > 0 else 0

            network_info = []
            try:
                pnic_info = getattr(host_system.config.network, 'pnic', None)
                write_log(f"PNIC info: {pnic_info}", "INFO")
                if pnic_info:
                    for nic in pnic_info:
                        speed_gbps = 0
                        if hasattr(nic, 'linkSpeed') and nic.linkSpeed:
                            speed_gbps = round(nic.linkSpeed.speedGb, 1)
                        nic_data = {
                            'name': getattr(nic, 'device', 'Unknown'),
                            'mac': getattr(nic, 'mac', 'N/A'),
                            'speed_gbps': speed_gbps,
                            'status': 'up' if (hasattr(nic, 'linkSpeed') and nic.linkSpeed) else 'down'
                        }
                        write_log(f"NIC data: {nic_data}", "INFO")
                        network_info.append(nic_data)
            except Exception as e:
                write_log(f"Network info error: {str(e)}", "WARNING")

            gpu_info = []
            try:
                devices = getattr(host_system.hardware, 'device', [])
                write_log(f"GPU devices count: {len(devices)}", "INFO")
                for device in devices:
                    device_str = str(device)
                    if 'NVIDIA' in device_str.upper() or 'GPU' in device_str.upper() or 'VGA' in device_str.upper():
                        vram = 0
                        if hasattr(device, 'videoRamSize'):
                            vram = int(device.videoRamSize) // (1024**2)
                        gpu_info.append({
                            'name': getattr(device, 'name', str(device)),
                            'vendor': getattr(device, 'vendorName', 'Unknown'),
                            'model': getattr(device, 'name', str(device)),
                            'vram': vram,
                            'driver_version': getattr(device, 'driverVersion', 'N/A')
                        })
                        write_log(f"GPU found: {gpu_info[-1]}", "INFO")
            except Exception as e:
                write_log(f"GPU info error: {str(e)}", "WARNING")

            if host_system.hardware.memorySize:
                memory_total = host_system.hardware.memorySize / (1024**3)
                memory_usage = host_system.summary.quickStats.overallMemoryUsage * 1024 * 1024 / (1024**3)
                memory_free = memory_total - memory_usage
                memory_usage_percent = (memory_usage / memory_total * 100) if memory_total > 0 else 0

            for datastore in host_system.datastore:
                try:
                    capacity = getattr(datastore.summary, 'capacity', 0)
                    free_space = getattr(datastore.summary, 'freeSpace', 0)
                    if capacity > 0:
                        disk_info.append({
                            'name': datastore.name,
                            'capacity': capacity / (1024**3),
                            'free': free_space / (1024**3),
                            'usage_percent': ((capacity - free_space) / capacity * 100) if capacity > 0 else 0
                        })
                except:
                    pass

            detailed_servers.append({
                'name': server.get('name', about.name),
                'host': server.get('host'),
                'remark': server.get('remark', ''),
                'connected': True,
                'vendor': about.vendor,
                'version': about.version,
                'build': about.build,
                'model': server_model,
                'server_vendor': server_vendor,
                'cpu': {
                    'count': cpu_count if host_system.hardware.cpuInfo else 0,
                    'cores': cpu_cores if host_system.hardware.cpuInfo else 0,
                    'usage_percent': round(cpu_usage_percent, 1),
                    'usage_ghz': round(cpu_usage / 1000, 2),
                    'total_ghz': round(cpu_total_mhz / 1000, 2)
                },
                'memory': {
                    'total': round(memory_total, 1),
                    'usage': round(memory_usage, 1),
                    'free': round(memory_free, 1),
                    'usage_percent': round(memory_usage_percent, 1)
                },
                'disks': disk_info,
                'vm_count': len(content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True).view)
            })

            connect.Disconnect(service_instance)
        except Exception as e:
            detailed_servers.append({
                'name': server.get('name', server.get('host')),
                'host': server.get('host'),
                'connected': False,
                'error': str(e)
            })

    return jsonify({'success': True, 'servers': detailed_servers})

@main_bp.route('/api/settings', methods=['GET'])
def api_get_settings():
    settings_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'settings.json')
    try:
        if os.path.exists(settings_path):
            with open(settings_path, 'r') as f:
                settings = json.load(f)
            return jsonify({'success': True, 'settings': settings})
        return jsonify({'success': True, 'settings': {'delay': 30}})
    except Exception as e:
        return jsonify({'success': True, 'settings': {'delay': 30}})

@main_bp.route('/api/settings', methods=['POST'])
def api_save_settings():
    settings_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'settings.json')
    try:
        os.makedirs(os.path.dirname(settings_path), exist_ok=True)
        data = request.json
        with open(settings_path, 'w') as f:
            json.dump(data, f)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/logs', methods=['GET'])
def api_logs():
    log_file = os.path.join(Config.LOG_PATH, f"{datetime.now().strftime('%Y%m%d')}-web.log")
    task_log_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs', 'task_executions.log')
    max_lines = request.args.get('lines', default=500, type=int)

    def read_log_file(filepath, max_lines):
        if not os.path.exists(filepath):
            return None
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                lines = f.readlines()
                return ''.join(lines[-max_lines:])
        except Exception as e:
            return f'[读取失败: {str(e)}]'

    try:
        logs_content = []
        sys_log = read_log_file(log_file, max_lines)
        if sys_log:
            logs_content.append('=== 系统日志 ===\n' + sys_log)
        task_log = read_log_file(task_log_file, 100)
        if task_log:
            logs_content.append('\n=== 任务执行日志 ===\n' + task_log)
        content = '\n'.join(logs_content) if logs_content else ''
        return jsonify({'success': True, 'logs': content})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/logs/clear', methods=['POST'])
def api_clear_logs():
    log_file = os.path.join(Config.LOG_PATH, f"{datetime.now().strftime('%Y%m%d')}-web.log")
    task_log_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs', 'task_executions.log')

    try:
        if os.path.exists(log_file):
            open(log_file, 'w').close()
        if os.path.exists(task_log_file):
            open(task_log_file, 'w').close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/servers/<host>/remark', methods=['POST'])
def api_update_server_remark(host):
    servers_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'servers.json')
    try:
        with open(servers_path, 'r') as f:
            servers = json.load(f)
        data = request.json
        for server in servers:
            if server.get('host') == host:
                server['remark'] = data.get('remark', '')
                break
        with open(servers_path, 'w') as f:
            json.dump(servers, f, ensure_ascii=False, indent=2)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/tasks', methods=['GET'])
def api_get_tasks():
    from .scheduler import load_tasks
    tasks = load_tasks()
    return jsonify({'success': True, 'tasks': tasks})

@main_bp.route('/api/scheduler/tasks', methods=['POST'])
def api_save_task():
    from .scheduler import add_or_update_task
    try:
        task = request.json
        if not task.get('id'):
            import uuid
            task['id'] = str(uuid.uuid4())[:8]
        result = add_or_update_task(task)
        return jsonify({'success': True, 'task': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/tasks/<task_id>', methods=['DELETE'])
def api_delete_task(task_id):
    from .scheduler import delete_task
    try:
        delete_task(task_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/tasks/<task_id>/pause', methods=['POST'])
def api_pause_task(task_id):
    from .scheduler import pause_task
    try:
        pause_task(task_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/tasks/<task_id>/resume', methods=['POST'])
def api_resume_task(task_id):
    from .scheduler import resume_task
    try:
        resume_task(task_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/holidays', methods=['GET'])
def api_get_holidays():
    from .scheduler import get_holidays
    holidays = get_holidays()
    return jsonify({'success': True, 'holidays': holidays})

@main_bp.route('/api/scheduler/holidays', methods=['POST'])
def api_save_holidays():
    from .scheduler import set_holidays
    try:
        holidays = request.json.get('holidays', [])
        set_holidays(holidays)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/holidays/sync', methods=['POST'])
def api_sync_holidays():
    from .scheduler import update_holidays_from_api
    try:
        holidays = update_holidays_from_api()
        return jsonify({'success': True, 'holidays': holidays, 'count': len(holidays)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@main_bp.route('/api/scheduler/tasks/<task_id>/run', methods=['POST'])
def api_run_task(task_id):
    from .scheduler import get_job
    try:
        task = get_job(task_id)
        if not task:
            return jsonify({'success': False, 'error': 'Task not found'})
        from .scheduler import execute_task
        result = execute_task(task)
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
