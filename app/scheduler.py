import os
import json
import logging
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.jobstores.memory import MemoryJobStore

logger = logging.getLogger(__name__)

JOBS_FILE = 'config/scheduled_tasks.json'
TASK_LOG_FILE = 'logs/task_executions.log'

_scheduler = None
_jobs = {}

def get_config():
    config_path = os.environ.get('CONFIG_PATH') or os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'config.json')
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except:
        return {}

def load_tasks():
    if not os.path.exists(JOBS_FILE):
        return []
    try:
        with open(JOBS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load tasks: {e}")
        return []

def save_tasks(tasks):
    os.makedirs('config', exist_ok=True)
    try:
        with open(JOBS_FILE, 'w', encoding='utf-8') as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save tasks: {e}")

def init_scheduler(app):
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler(
        jobstores={'default': MemoryJobStore()},
        job_defaults={
            'coalesce': True,
            'max_instances': 1,
            'misfire_grace_time': 60
        }
    )
    _scheduler.start()
    load_existing_jobs()
    logger.info("Scheduler initialized")
    return _scheduler

def load_existing_jobs():
    global _jobs
    tasks = load_tasks()
    for task in tasks:
        if task.get('enabled', True):
            add_job_to_scheduler(task)

def add_job_to_scheduler(task):
    global _scheduler, _jobs
    if _scheduler is None:
        return

    job_id = task['id']

    trigger_type = task.get('trigger_type', 'cron')

    if trigger_type == 'cron':
        cron = task.get('cron', {})
        day_of_week = cron.get('day_of_week', '0-6')

        logger.info(f"Task {job_id}: day_of_week raw = {repr(day_of_week)}")

        if ',' in str(day_of_week):
            days = str(day_of_week)
        elif '-' in str(day_of_week):
            start, end = str(day_of_week).split('-')
            days = ','.join([str(d) for d in range(int(start), int(end) + 1)])
        else:
            days = str(day_of_week)

        logger.info(f"Task {job_id}: days parsed = {repr(days)}")

        trigger = CronTrigger(
            day_of_week=days,
            hour=int(cron.get('hour', 0)),
            minute=int(cron.get('minute', 0))
        )
    elif trigger_type == 'interval':
        interval = task.get('interval', {})
        trigger = IntervalTrigger(
            minutes=int(interval.get('minutes', 0)),
            hours=int(interval.get('hours', 0))
        )
    else:
        return

    def job_func():
        execute_task(task)

    try:
        _scheduler.add_job(
            job_func,
            trigger=trigger,
            id=job_id,
            name=task.get('name', job_id),
            replace_existing=True
        )
        _jobs[job_id] = task
        logger.info(f"Job added to scheduler: {job_id}")
    except Exception as e:
        logger.error(f"Failed to add job {job_id}: {e}")

def remove_job_from_scheduler(job_id):
    global _scheduler, _jobs
    if _scheduler and job_id in _jobs:
        try:
            _scheduler.remove_job(job_id)
            del _jobs[job_id]
            logger.info(f"Job removed from scheduler: {job_id}")
        except Exception as e:
            logger.error(f"Failed to remove job {job_id}: {e}")

def log_task_execution(task_id, task_name, action, target_vms, results, status='completed'):
    try:
        os.makedirs('logs', exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = {
            'timestamp': timestamp,
            'task_id': task_id,
            'task_name': task_name,
            'action': action,
            'target_vms': target_vms,
            'success_count': results.get('success', 0),
            'failed_count': results.get('failed', 0),
            'details': results.get('details', []),
            'status': status
        }
        with open(TASK_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + '\n')
    except Exception as e:
        logger.error(f"Failed to log task execution: {e}")

def execute_task(task):
    import requests
    from .main import Config

    logger.info(f"Executing scheduled task: {task['name']}")
    task_id = task.get('id', 'unknown')
    task_name = task.get('name', 'unknown')

    action = task.get('action', '')
    target_vms = task.get('target_vms', [])

    results = {'success': 0, 'failed': 0, 'details': []}

    config = get_config()
    base_url = config.get('api_base_url', 'http://127.0.0.1:5000')

    for vm in target_vms:
        try:
            vm_name = vm['name']
            server_host = vm['server_host']

            response = requests.post(
                f"{base_url}/api/vm/{action}",
                json={'name': vm_name, 'server_host': server_host},
                timeout=30
            )
            result = response.json()

            if result.get('success'):
                results['success'] += 1
            else:
                results['failed'] += 1
                results['details'].append(f"{vm_name}: {result.get('error', 'Unknown error')}")
        except Exception as e:
            results['failed'] += 1
            results['details'].append(f"{vm['name']}: {str(e)}")

    notify_result(task, results)
    log_task_execution(task_id, task_name, action, target_vms, results)

    return results

def notify_result(task, results):
    global_config = get_config()
    notification_settings = global_config.get('notification', {})
    if not notification_settings.get('enabled'):
        return

    msg = f"📋 任务通知: {task['name']}\n"
    msg += f"⏰ 执行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    msg += f"✅ 执行结果: 成功 {results['success']} | ❌ 失败 {results['failed']}\n"
    if results['details']:
        msg += f"📝 详情:\n" + "\n".join(results['details'])

    if notification_settings.get('wechat_enabled') and notification_settings.get('wechat_url'):
        send_wechat_message(notification_settings['wechat_url'], msg)

    if notification_settings.get('dingtalk_enabled') and notification_settings.get('dingtalk_url'):
        send_dingtalk_message(notification_settings['dingtalk_url'], msg)

    if notification_settings.get('feishu_enabled') and notification_settings.get('feishu_url'):
        send_feishu_message(notification_settings['feishu_url'], msg)

    if notification_settings.get('slack_enabled') and notification_settings.get('slack_url'):
        send_slack_message(notification_settings['slack_url'], msg)

    if notification_settings.get('telegram_enabled') and notification_settings.get('telegram_bot_token') and notification_settings.get('telegram_chat_id'):
        send_telegram_message(notification_settings['telegram_bot_token'], notification_settings['telegram_chat_id'], msg)

def send_wechat_message(webhook_url, message):
    try:
        import requests
        payload = {
            "msgtype": "text",
            "text": {
                "content": message
            }
        }
        resp = requests.post(webhook_url, json=payload, timeout=10)
        logger.info(f"WeChat notification sent: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to send WeChat notification: {e}")

def send_dingtalk_message(webhook_url, message):
    try:
        import requests
        payload = {
            "msgtype": "text",
            "text": {
                "content": message
            }
        }
        resp = requests.post(webhook_url, json=payload, timeout=10)
        logger.info(f"DingTalk notification sent: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to send DingTalk notification: {e}")

def send_feishu_message(webhook_url, message):
    try:
        import requests
        payload = {
            "msg_type": "text",
            "content": {
                "text": message
            }
        }
        resp = requests.post(webhook_url, json=payload, timeout=10)
        logger.info(f"Feishu notification sent: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to send Feishu notification: {e}")

def send_slack_message(webhook_url, message):
    try:
        import requests
        payload = {
            "text": message
        }
        resp = requests.post(webhook_url, json=payload, timeout=10)
        logger.info(f"Slack notification sent: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to send Slack notification: {e}")

def send_telegram_message(bot_token, chat_id, message):
    try:
        import requests
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML"
        }
        resp = requests.post(url, json=payload, timeout=10)
        logger.info(f"Telegram notification sent: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to send Telegram notification: {e}")

def get_scheduler():
    return _scheduler

def get_all_jobs():
    return list(_jobs.values())

def get_job(job_id):
    return _jobs.get(job_id)

def add_or_update_task(task):
    tasks = load_tasks()
    task_id = task.get('id')

    if not task_id:
        import uuid
        task_id = str(uuid.uuid4())[:8]
        task['id'] = task_id

    logger.info(f"Saving task: {task_id} - {task.get('name')}")

    existing_idx = None
    for i, t in enumerate(tasks):
        if t['id'] == task_id:
            existing_idx = i
            break

    if existing_idx is not None:
        tasks[existing_idx] = task
    else:
        tasks.append(task)

    save_tasks(tasks)
    logger.info(f"Task saved, removing from scheduler: {task_id}")
    remove_job_from_scheduler(task_id)
    if task.get('enabled', True):
        logger.info(f"Adding job to scheduler: {task_id}")
        add_job_to_scheduler(task)

    return task

def delete_task(task_id):
    tasks = load_tasks()
    tasks = [t for t in tasks if t['id'] != task_id]
    save_tasks(tasks)
    remove_job_from_scheduler(task_id)

def pause_task(task_id):
    tasks = load_tasks()
    for task in tasks:
        if task['id'] == task_id:
            task['enabled'] = False
            break
    save_tasks(tasks)
    remove_job_from_scheduler(task_id)

def resume_task(task_id):
    tasks = load_tasks()
    for task in tasks:
        if task['id'] == task_id:
            task['enabled'] = True
            break
    save_tasks(tasks)
    task = get_job(task_id)
    if task:
        add_job_to_scheduler(task)

def is_workday():
    today = datetime.now().weekday()
    return today < 5

def is_holiday(date_str=None):
    if date_str is None:
        date_str = datetime.now().strftime('%Y-%m-%d')

    holidays_file = 'config/holidays.json'
    if not os.path.exists(holidays_file):
        return False

    try:
        with open(holidays_file, 'r', encoding='utf-8') as f:
            holidays = json.load(f)
        return date_str in holidays
    except:
        return False

def fetch_china_holidays(year=None):
    if year is None:
        year = datetime.now().year

    apis = [
        ("https://api.jiejiariapi.com/v1/holidays", "jiejiariapi"),
        ("https://holidays-api.cn/api/v1/holidays", "holidays-api.cn"),
    ]

    for api_url, api_name in apis:
        try:
            import urllib.request
            url = f"{api_url}/{year}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode('utf-8'))
                holidays = []
                if api_name == "jiejiariapi" and data.get('code') == 200 and data.get('data'):
                    for month_data in data['data'].values():
                        if isinstance(month_data, list):
                            for day_info in month_data:
                                if day_info.get('is_holiday'):
                                    holidays.append(day_info.get('date'))
                    if holidays:
                        logger.info(f"Fetched {len(holidays)} holidays from jiejiariapi")
                        return holidays
                elif api_name == "holidays-api.cn" and data.get('data'):
                    for item in data['data']:
                        if item.get('is_holiday'):
                            holidays.append(item.get('date'))
                    if holidays:
                        logger.info(f"Fetched {len(holidays)} holidays from holidays-api.cn")
                        return holidays
        except Exception as e:
            logger.warning(f"Failed to fetch holidays from {api_url}: {e}")

    try:
        import urllib.request
        url = f"https://timor.tech/api/holiday/year/{year}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            holidays = []
            if data.get('code') == 0 and data.get('holiday'):
                for day_info in data['holiday'].values():
                    if day_info.get('holiday'):
                        holidays.append(day_info['date'])
                logger.info(f"Fetched {len(holidays)} holidays from timor.tech")
                return holidays
    except Exception as e:
        logger.warning(f"Failed to fetch holidays from timor.tech: {e}")

    return []

def is_workday_exclusive(date_str=None):
    if date_str is None:
        date_str = datetime.now().strftime('%Y-%m-%d')

    if is_holiday(date_str):
        return False

    try:
        date = datetime.strptime(date_str, '%Y-%m-%d')
        return date.weekday() < 5
    except:
        return False

def set_holidays(holidays_list):
    os.makedirs('config', exist_ok=True)
    with open('config/holidays.json', 'w', encoding='utf-8') as f:
        json.dump(holidays_list, f, ensure_ascii=False, indent=2)

def get_holidays():
    holidays_file = 'config/holidays.json'
    if not os.path.exists(holidays_file):
        return []
    try:
        with open(holidays_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []

def update_holidays_from_api(year=None):
    holidays = fetch_china_holidays(year)
    if holidays:
        set_holidays(holidays)
    return holidays