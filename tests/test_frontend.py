import pytest


class TestVMFiltering:
    def test_vm_state_filtering_logic(self):
        filter_states = {
            'poweredOn': True,
            'suspended': True,
            'poweredOff': True
        }

        vm_states = ['poweredOn', 'poweredOff', 'suspended', 'poweredOn']

        visible_vms = []
        for state in vm_states:
            if (state == 'poweredOn' and filter_states.get('poweredOn', True)) or \
               (state == 'suspended' and filter_states.get('suspended', True)) or \
               (state == 'poweredOff' and filter_states.get('poweredOff', True)):
                visible_vms.append(state)

        assert len(visible_vms) == 4

    def test_vm_state_filtering_partial(self):
        filter_states = {
            'poweredOn': True,
            'suspended': False,
            'poweredOff': False
        }

        vm_states = ['poweredOn', 'poweredOff', 'suspended', 'poweredOn']

        visible_vms = []
        for state in vm_states:
            if (state == 'poweredOn' and filter_states.get('poweredOn', True)) or \
               (state == 'suspended' and filter_states.get('suspended', True)) or \
               (state == 'poweredOff' and filter_states.get('poweredOff', True)):
                visible_vms.append(state)

        assert len(visible_vms) == 2
        assert 'poweredOn' in visible_vms
        assert 'suspended' not in visible_vms

    def test_vm_search_and_state_combined(self):
        search_term = 'web'
        filter_states = {
            'poweredOn': True,
            'suspended': True,
            'poweredOff': True
        }

        vms = [
            {'name': 'web-server-1', 'state': 'poweredOn'},
            {'name': 'db-server', 'state': 'poweredOn'},
            {'name': 'web-server-2', 'state': 'poweredOff'},
            {'name': 'cache-server', 'state': 'suspended'}
        ]

        visible_vms = []
        for vm in vms:
            matches_search = search_term in vm['name'].lower()
            matches_state = (vm['state'] == 'poweredOn' and filter_states.get('poweredOn', True)) or \
                           (vm['state'] == 'suspended' and filter_states.get('suspended', True)) or \
                           (vm['state'] == 'poweredOff' and filter_states.get('poweredOff', True))

            if matches_search and matches_state:
                visible_vms.append(vm['name'])

        assert len(visible_vms) == 2
        assert 'web-server-1' in visible_vms
        assert 'web-server-2' in visible_vms
        assert 'db-server' not in visible_vms


class TestEstimatedTimeCalculation:
    def test_estimated_time_with_delay(self):
        current_delay = 30
        selected_count = 5
        estimated_time = (selected_count - 1) * current_delay
        assert estimated_time == 120

    def test_estimated_time_single_vm(self):
        current_delay = 30
        selected_count = 1
        estimated_time = (selected_count - 1) * current_delay
        assert estimated_time == 0

    def test_estimated_time_no_delay(self):
        current_delay = 0
        selected_count = 5
        estimated_time = (selected_count - 1) * current_delay
        assert estimated_time == 0


class TestAutoRefresh:
    def test_auto_refresh_interval_calculation(self):
        auto_refresh = 60
        interval_ms = auto_refresh * 1000
        assert interval_ms == 60000

    def test_auto_refresh_disabled(self):
        auto_refresh = 0
        should_refresh = auto_refresh > 0
        assert should_refresh is False
