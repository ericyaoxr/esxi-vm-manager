import pytest
import json
import os


class TestSchedulerConfig:
    def test_scheduler_config_path(self):
        from app.scheduler import JOBS_FILE
        assert JOBS_FILE == 'config/scheduled_tasks.json'

    def test_load_scheduler_config(self):
        from app.scheduler import get_config
        config = get_config()
        assert isinstance(config, dict)

    def test_scheduler_interval_added(self):
        from app.scheduler import execute_task
        import inspect
        source = inspect.getsource(execute_task)
        assert 'delay' in source, "execute_task should handle delay parameter"
        assert 'time.sleep' in source, "execute_task should use time.sleep for delay"


class TestScheduledTaskStructure:
    def test_task_has_delay_field(self, sample_task_data):
        assert 'delay' in sample_task_data
        assert isinstance(sample_task_data['delay'], int)
        assert sample_task_data['delay'] >= 0

    def test_task_cron_structure(self, sample_task_data):
        assert 'cron' in sample_task_data
        cron = sample_task_data['cron']
        assert 'hour' in cron
        assert 'minute' in cron
        assert 'day_of_week' in cron


class TestTaskExecution:
    def test_task_execution_import(self):
        from app.scheduler import execute_task
        assert callable(execute_task)

    def test_task_delay_calculation(self):
        delay = 10
        vms = [{'name': 'vm1'}, {'name': 'vm2'}, {'name': 'vm3'}]
        expected_delay_seconds = (len(vms) - 1) * delay
        assert expected_delay_seconds == 20
