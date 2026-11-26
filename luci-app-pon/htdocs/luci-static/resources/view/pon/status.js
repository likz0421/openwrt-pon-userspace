// SPDX-License-Identifier: Apache-2.0

'use strict';
'require dom';
'require fs';
'require poll';
'require uci';
'require view';

function isEponMode(mode) {
	return (mode || '').indexOf('epon-') === 0;
}

function modeLabel(mode) {
	switch (mode) {
	case 'gpon': return _('GPON');
	case 'xgpon': return _('XG-PON');
	case 'xgspon': return _('XGS-PON');
	case 'epon-1g': return _('EPON 1G/1G');
	case 'epon-10g-1g': return _('10G-EPON 10G/1G');
	case 'epon-10g-10g': return _('10G-EPON 10G/10G');
	case 'none': return _('Not active');
	default: return mode || _('Not active');
	}
}

function getLineModes(item) {
	var line = item.line || {};
	var configured = line.configured_mode || item.section.mode || '';
	var active = line.active_mode;

	if (active === 'none')
		active = '';

	return {
		configured: configured,
		active: active,
		shown: active || configured,
		pending: line.mode_pending === true
	};
}

function displayBoolean(value) {
	if (value === true || value === 1 || value === '1')
		return _('Yes', 'PON status boolean');
	if (value === false || value === 0 || value === '0')
		return _('No', 'PON status boolean');
	return _('Unknown');
}

function displayFrontendMetric(frontend, field, unit) {
	if (frontend.error)
		return _('Read failed');
	if (!Object.prototype.hasOwnProperty.call(frontend, field))
		return _('Not supported');
	return Number(frontend[field]).toFixed(2) + ' ' + unit;
}

function displayLifecycle(value) {
	switch (value) {
	case 'stopped': return _('Stopped');
	case 'wait-optical-signal': return _('Waiting for optical signal');
	case 'pma-configured': return _('PMA configured');
	case 'wait-line-sync': return _('Waiting for line synchronization');
	case 'protocol-activating': return _('Protocol activation in progress');
	case 'operational': return _('Operational');
	case 'error': return _('Error');
	default: return value || _('Unknown');
	}
}

function displayMpcpState(value) {
	switch (value) {
	case 'wait': return _('Waiting for discovery');
	case 'registering': return _('Waiting for Discovery Gate');
	case 'register-request': return _('Register Request sent');
	case 'register-pending': return _('Register received; ACK pending');
	case 'registered': return _('Registered');
	case 'denied': return _('Registration denied');
	default: return value || _('Unknown');
	}
}

function displayOnuState(value) {
	switch (value) {
	case 'O1': return _('O1 — Initial');
	case 'O2_3': return _('O2-3 — Serial number');
	case 'O4': return _('O4 — Ranging');
	case 'O5': return _('O5 — Operation');
	case 'O7': return _('O7 — Emergency stop');
	default: return value || _('Unknown');
	}
}

function displaySync(value) {
	if (value === 'not-applicable') return _('Not applicable');
	switch (value) {
	case 'hunt': return _('Hunt');
	case 'pre-sync': return _('Pre-sync');
	case 'in-sync': return _('Synchronized');
	case 're-sync': return _('Re-synchronizing');
	default: return value || _('Unknown');
	}
}

function displayAuthentication(value) {
	switch (value) {
	case 'not-requested': return _('OLT did not request authentication');
	case 'pending': return _('Pending');
	case 'not-reported': return _('Not reported');
	case 'not-authenticated': return _('Not authenticated');
	case 'accepted': return _('Accepted');
	case 'loid-not-found': return _('LOID does not exist');
	case 'password-mismatch': return _('LOID exists, but the password is incorrect');
	case 'loid-conflict': return _('LOID is already authenticated by another ONU');
	case 'reserved-status': return _('Reserved authentication status');
	default: return value || _('Unknown');
	}
}

function displayBackendState(value) {
	switch (value) {
	case 'inactive': return _('PON line stopped');
	case 'waiting-for-gem': return _('Waiting for GEM configuration');
	case 'waiting-for-alloc-id': return _('Waiting for PLOAM Alloc-ID assignment');
	case 'alloc-id-timeout': return _('PLOAM did not assign the Alloc-IDs in time');
	case 'kernel-mapping-present': return _('Existing kernel mapping');
	case 'applied': return _('Applied');
	case 'multiple-gems-unsupported': return _('Multiple data paths require packet classification');
	case 'apply-failed': return _('Failed to apply mapping');
	case 'clear-failed': return _('Failed to clear mapping');
	default: return value || _('Unknown');
	}
}

function displayCtcDiscovery(value) {
	switch (value) {
	case 'passive-wait': return _('Waiting for CTC discovery');
	case 'version-offered': return _('CTC version offered');
	case 'operational': return _('Operational');
	default: return value || _('Unknown');
	}
}

function displayVlanMode(value) {
	switch (value) {
	case 0: return _('Transparent');
	case 1: return _('Tag');
	case 2: return _('Translation');
	case 3: return _('N:1 aggregation');
	case 4: return _('Trunk');
	default: return _('Not provisioned');
	}
}

function displayVlanIds(values) {
	return Array.isArray(values.vlan_ids) && values.vlan_ids.length > 0
		? values.vlan_ids.join(', ') : _('Not provisioned');
}

function displayOmciVlanIds(values) {
	if (Array.isArray(values.vlan_ids) && values.vlan_ids.length > 0)
		return values.vlan_ids.join(', ');
	if (values.data_path_all_vlans === true)
		return _('Any VLAN (transparent)');
	return _('Not provisioned');
}

function displayMulticastVlanIds(values) {
	return Array.isArray(values.multicast_vlan_ids) && values.multicast_vlan_ids.length > 0
		? values.multicast_vlan_ids.join(', ') : _('Not provisioned');
}

function displayIgmpUpstreamVlanIds(values) {
	if (Array.isArray(values.igmp_upstream_vlan_ids) && values.igmp_upstream_vlan_ids.length > 0)
		return values.igmp_upstream_vlan_ids.join(', ');
	if (Array.isArray(values.igmp_upstream_tag_controls) &&
	    values.igmp_upstream_tag_controls.indexOf(0) >= 0)
		return _('Unchanged');
	return _('Not provisioned');
}

function displayIgmpTagControl(values) {
	var labels = {
		0: _('Transparent'),
		1: _('Add tag'),
		2: _('Replace TCI'),
		3: _('Replace VID')
	};

	return Array.isArray(values.igmp_upstream_tag_controls) &&
		values.igmp_upstream_tag_controls.length > 0
		? values.igmp_upstream_tag_controls.map(function(value) {
			return labels[value] || String(value);
		}).join(', ')
		: _('Not provisioned');
}

function displayBroadcastKeys(values) {
	if (!values.enhanced_security)
		return _('Enhanced security disabled');
	return Array.isArray(values.broadcast_key_indexes) && values.broadcast_key_indexes.length > 0
		? _('Key index %s').format(values.broadcast_key_indexes.join(', ')) : _('Not provisioned');
}

function loadProtocolStatus(section, unavailable, invalid) {
	return L.resolveDefault(
		fs.exec_direct('/usr/bin/pondctl', [ 'status', '--line', section.line ]), null
	).then(function(output) {
		if (output == null)
			return { section: section, values: {}, error: unavailable };
		try {
			return { section: section, values: JSON.parse(output), error: null };
		} catch (exception) {
			return { section: section, values: {}, error: invalid };
		}
	});
}

function loadStatus() {
	var lines = uci.sections('pon', 'xpon'),
		lineByName = {};

	lines.forEach(function(section) {
		lineByName[section['.name']] = section;
	});

	var lineJobs = lines.map(function(section) {
		var device = section.device || '';

		if (!device)
			return Promise.resolve({ section: section, line: {}, error: _('No device configured') });
		return L.resolveDefault(fs.exec_direct('/usr/sbin/ponctl',
			[ '--device', device, 'status', '--json' ]), null).then(function(output) {
			var snapshot;
			try {
				snapshot = JSON.parse(output);
				if (snapshot.schema_version !== 1 || !snapshot.line)
					throw new Error('status schema');
			} catch (error) {
				return { section: section, line: {},
					error: output == null ? _('Device unavailable') :
						_('Invalid status response') };
			}
			return {
				section: section,
				line: snapshot.line,
				frontend: snapshot.frontend,
				registration: snapshot.registration,
				datapath: snapshot.datapath,
				counters: snapshot.counters
			};
		});
	});

	return Promise.all([
		Promise.all(lineJobs),
			Promise.all(uci.sections('pon', 'omci').filter(function(section) {
				var line = lineByName[section.line], mode = line ? line.mode || '' : '';
				return mode.indexOf('epon-') !== 0;
			}).map(function(section) {
				return loadProtocolStatus(section,
					_('Unable to read OMCI status'), _('Invalid OMCI status response'));
			})),
			Promise.all(uci.sections('pon', 'oam').filter(function(section) {
				var line = lineByName[section.line], mode = line ? line.mode || '' : '';
				return mode.indexOf('epon-') === 0;
			}).map(function(section) {
				return loadProtocolStatus(section,
					_('Unable to read OAM status'), _('Invalid OAM status response'));
		}))
	]).then(function(results) {
		return { lines: results[0], omci: results[1], oam: results[2] };
	});
}

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width: 42%' }, label),
		E('td', { 'class': 'td left' }, value == null || value === '' ? _('Unknown') : String(value))
	]);
}

function statusTable(title, rows) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title), E('table', { 'class': 'table' }, rows)
	]);
}

function detailsTable(title, rows, instance) {
	return E('details', {
		'class': 'cbi-section',
		'data-pon-details': instance
	}, [
		E('summary', {}, E('strong', {}, title)),
		E('table', { 'class': 'table' }, rows)
	]);
}

function modeRows(mode) {
	return [
		row(_('Current line mode'), modeLabel(mode.active)),
		row(_('Configured line mode'), modeLabel(mode.configured)),
		row(_('Configuration state'), !mode.active ? _('Line stopped') :
			(mode.pending ? _('Takes effect after interface restart') : _('Applied')))
	];
}

function renderLine(item) {
	var line = item.line || {};
	var frontend = item.frontend || {};
	var registration = item.registration || {};
	var counters = item.counters || {};
	var datapath = item.datapath || {};
	var mode = getLineModes(item);
	var title = _('PON line: %s (%s)').format(item.section['.name'], item.section.device || '-');
	var main = modeRows(mode);
	var details;

	if (item.error)
		return { mode: mode.shown, nodes: [ statusTable(title, [ row(_('Error'), item.error) ]) ] };
	main.push(
		row(_('Line state'), displayLifecycle(line.lifecycle)),
		row(_('Optical signal detected'), displayBoolean(line.optical_signal)),
		row(_('Receive optical power'), displayFrontendMetric(
			frontend, 'rx_power_dbm', 'dBm')),
		row(_('Transmit optical power'), displayFrontendMetric(
			frontend, 'tx_power_dbm', 'dBm')),
		row(_('Optical frontend temperature'), displayFrontendMetric(
			frontend, 'temperature_celsius', '°C'))
	);
	if (isEponMode(mode.shown)) {
		main.push(
			row(_('PCS synchronized'), displayBoolean(line.pcs_sync)),
			row(_('MPCP state'), displayMpcpState(registration.mpcp_state)),
			row(_('LLID0'), registration.llid_valid === true ? registration.llid : _('Not assigned')),
			row(_('LLID0 data path configured'), displayBoolean(datapath.data_path_configured)),
			row(_('Upstream burst transmitter ready'), displayBoolean(registration.upstream_tx_armed))
		);
		details = [
			row(_('Last start error'), line.last_start_error),
			row(_('PCS profile'), line.pcs_profile_valid ? line.pcs_profile : _('Not configured')),
			row(_('Receiver activation count'), counters.rx_start_count),
			row(_('PCS synchronization losses'), counters.sync_losses),
			row(_('PCS recovery attempts'), counters.recoveries),
			row(_('Full PMA reinitializations'), counters.full_reinitializations),
			row(_('Discovery Gates received'), counters.discovery_gates),
			row(_('Register Request commands submitted'), counters.register_requests),
			row(_('Register messages received'), counters.register_messages),
			row(_('Register ACKs transmitted'), counters.register_acks),
			row(_('Register NACKs'), counters.register_nacks),
			row(_('MPCP timeouts'), counters.mpcp_timeouts),
			row(_('MAC error conditions'), counters.mac_errors)
		];
	} else {
		main.push(
			row(_('PHY ready'), displayBoolean(line.phy_ready)),
			row(mode.shown === 'gpon' ? _('GTC state') : _('XGTC state'),
				displaySync(line.xgtc_sync)),
			row(_('ONU state'), displayOnuState(registration.onu_state)),
			row(_('ONU-ID'), registration.onu_id_valid === true ? registration.onu_id : _('Not assigned')),
			row(_('Kernel data path configured'), displayBoolean(datapath.data_path_configured)),
			row(_('Service ready'), displayBoolean(datapath.service_ready)),
			row(_('Upstream burst transmitter ready'), displayBoolean(registration.upstream_tx_armed))
		);
		details = [
			row(_('Last start error'), line.last_start_error),
			row(_('Receiver activation count'), counters.rx_start_count),
			row(_('Line synchronization losses'), counters.sync_losses),
			row(_('Receiver recovery attempts'), counters.recoveries),
			row(_('Full PMA reinitializations'), counters.full_reinitializations),
			row(_('Downstream transport frames'), counters.xgtc_rx),
			row(_('Downstream PLOAMd received'), counters.ploamd_rx),
			row(_('Downstream GEM frames'), counters.xgem_rx),
			row(_('Upstream bursts transmitted'), counters.upstream_bursts_tx),
			row(_('Upstream PLOAMu transmitted'), counters.ploamu_tx),
			row(_('Upstream GEM frames'), counters.xgem_tx)
		];
	}
	details.push(
		row(_('Calibration state'), ({
			ready: _('Loaded'), missing: _('Missing'), invalid: _('Invalid format'),
			'not-required': _('Not required'), unknown: _('Unknown')
		})[frontend.calibration] || _('Unknown')),
		row(_('Frontend TX gate enabled'), frontend.error ?
			_('Read failed') : displayBoolean(frontend.tx_gate_enabled))
	);

	return { mode: mode.shown, nodes: [
		statusTable(title, main),
		detailsTable(isEponMode(mode.shown) ? _('EPON line counters and diagnostics') :
			_('ITU-T PON counters and diagnostics'), details, item.section['.name'])
	] };
}

function renderOmci(item) {
	var values = item.values;
	var title = _('OMCI: %s (%s)').format(item.section['.name'], item.section.device || '-');

	if (item.error)
		return statusTable(title, [ row(_('Error'), item.error) ]);
	return statusTable(title, [
		row(_('OMCI channel online'), displayBoolean(values.channel_available)),
		row(_('LOID configured locally'), displayBoolean(values.loid_configured)),
		row(_('LOID authentication'), displayAuthentication(values.authentication_meaning)),
		row(_('OLT vendor ID'), values.olt_vendor_id),
		row(_('OLT equipment ID'), values.olt_equipment_id),
		row(_('OLT version'), values.olt_version),
		row(_('Data path state'), displayBackendState(values.backend_state)),
		row(_('Active Alloc-ID'), values.active_alloc_id),
		row(_('Active GEM-ID'), values.active_gem_id),
		row(_('OMCI VLAN IDs'), displayOmciVlanIds(values)),
		row(_('Multicast downstream VLAN IDs'), displayMulticastVlanIds(values)),
		row(_('IGMP upstream tag action'), displayIgmpTagControl(values)),
		row(_('IGMP upstream VLAN IDs'), displayIgmpUpstreamVlanIds(values)),
		row(_('OLT broadcast keys'), displayBroadcastKeys(values)),
		row(_('Received OMCI messages'), values.rx_messages),
		row(_('OMCI parse errors'), values.parse_errors)
	]);
}

function renderOam(item) {
	var values = item.values;
	var title = _('EPON OAM: %s (%s)').format(item.section['.name'], item.section.device || '-');
	var rows;

	if (item.error)
		return statusTable(title, [ row(_('Error'), item.error) ]);
	rows = [
		row(_('LLID OAM channel online'), displayBoolean(values.channel_available)),
		row(_('IEEE OAM discovery completed'),
			displayBoolean(values.ieee_discovery_completed)),
		row(_('Configured OAM profile'), values.operator === 'ctc' ?
			_('IEEE 802.3ah + CTC') : _('IEEE 802.3ah'))
	];
	if (values.operator === 'ctc') {
		rows.push(
			row(_('CTC discovery'), displayCtcDiscovery(values.ctc_discovery_state)),
			row(_('CTC version'), values.ctc_version == null ?
				_('Not negotiated') : '0x' + Number(values.ctc_version).toString(16)),
			row(_('LOID configured locally'), displayBoolean(values.loid_configured)),
			row(_('LOID authentication'), displayAuthentication(values.authentication_status)),
			row(_('CTC VLAN mode'), displayVlanMode(values.vlan_mode)),
			row(_('CTC VLAN IDs'), displayVlanIds(values))
		);
	}
	rows.push(
		row(_('Received OAM messages'), values.rx_messages),
		row(_('OAM parse errors'), values.parse_errors)
	);
	return statusTable(title, rows);
}

/* Dashboard: compact at-a-glance cards above the detailed tables. */
var DASH_CSS = [
	'.pon-dashboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:12px 0 18px}',
	'.pon-card{border:1px solid var(--border-color,rgba(0,0,0,.15));border-left:4px solid var(--border-color,rgba(0,0,0,.3));border-radius:8px;padding:12px 14px;background:var(--background-color-primary,#fff)}',
	'.pon-card.pon-ok{border-left-color:#2ecc71}.pon-card.pon-warn{border-left-color:#f39c12}.pon-card.pon-err{border-left-color:#e74c3c}',
	'.pon-card-title{font-weight:600;margin-bottom:8px}.pon-card-mode{font-size:12px;color:var(--text-color-secondary,#888)}',
	'.pon-metric{display:flex;justify-content:space-between;gap:8px;font-size:13px;line-height:1.7}',
	'.pon-metric-label{color:var(--text-color-secondary,#888)}.pon-metric-value{font-weight:500;text-align:right}',
	'.pon-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:rgba(0,0,0,.06)}',
	'.pon-badge.pon-ok{background:rgba(46,204,113,.16);color:#1e8449}',
	'.pon-badge.pon-warn{background:rgba(243,156,18,.16);color:#b9770e}',
	'.pon-badge.pon-err{background:rgba(231,76,60,.16);color:#c0392b}',
	'@media(prefers-color-scheme:dark){.pon-card{background:rgba(255,255,255,.05)}.pon-badge.pon-ok{color:#2ecc71}.pon-badge.pon-warn{color:#f39c12}.pon-badge.pon-err{color:#e74c3c}}'
].join('');

function dashTone(lifecycle, error) {
	if (error || lifecycle === 'error')
		return 'pon-err';
	if (lifecycle === 'operational')
		return 'pon-ok';
	if (!lifecycle || lifecycle === 'stopped')
		return 'pon-warn';
	return 'pon-warn';
}

function dashMetric(label, value) {
	return E('div', { 'class': 'pon-metric' }, [
		E('span', { 'class': 'pon-metric-label' }, label),
		E('span', { 'class': 'pon-metric-value' }, value)
	]);
}

function renderDashboard(data) {
	var cards = [];
	data.lines.forEach(function(item) {
		var line = item.line || {};
		var frontend = item.frontend || {};
		var mode = getLineModes(item);
		var tone = dashTone(line.lifecycle, item.error);
		var rx = frontend.error ? _('Read failed') :
			(Object.prototype.hasOwnProperty.call(frontend, 'rx_power_dbm') ?
				Number(frontend.rx_power_dbm).toFixed(2) + ' dBm' : _('Not supported'));
		cards.push(E('div', { 'class': 'pon-card ' + tone }, [
			E('div', { 'class': 'pon-card-title' }, [
				item.section['.name'],
				E('span', { 'class': 'pon-badge ' + tone }, ' ' + displayLifecycle(line.lifecycle))
			]),
			E('div', { 'class': 'pon-card-mode' }, modeLabel(mode.shown) + ' · ' + (item.section.device || '-')),
			dashMetric(_('Line state'), displayLifecycle(line.lifecycle)),
			dashMetric(_('Receive optical power'), rx),
			dashMetric(_('Optical signal'), displayBoolean(line.optical_signal)),
			dashMetric(_('Service ready'), (item.datapath || {}).service_ready === true ? _('Yes') : _('No'))
		]));
	});
	if (!cards.length)
		return E('div');
	return E('div', { 'class': 'pon-dashboard' }, cards);
}

function renderStatus(data) {
	var nodes = [];
	var activeModes = {};

	data.lines.forEach(function(item) {
		var rendered = renderLine(item);

		activeModes[item.section['.name']] = rendered.mode;
		rendered.nodes.forEach(function(node) { nodes.push(node); });
	});
	data.omci.forEach(function(item) {
		if (!isEponMode(activeModes[item.section.line || '']))
			nodes.push(renderOmci(item));
	});
	data.oam.forEach(function(item) {
		if (isEponMode(activeModes[item.section.line || '']))
			nodes.push(renderOam(item));
	});

	if (nodes.length === 0)
		nodes.push(E('p', {}, _('No PON instances are configured.')));
	return nodes;
}

return view.extend({
	load: function() {
		return uci.load('pon').then(loadStatus);
	},

	render: function(data) {
		var dashboard = E('div', { 'id': 'pon-dashboard' }, renderDashboard(data));
		var container = E('div', { 'id': 'pon-status' }, renderStatus(data));
		var root = E('div', { 'class': 'cbi-map' }, [
			E('style', {}, DASH_CSS),
			E('h2', {}, _('PON status')),
			dashboard,
			container
		]);

		poll.add(function() {
			return loadStatus().then(function(status) {
				var opened = Object.create(null);

				/* Polling rebuilds the tables, so keep expanded counters open. */
				container.querySelectorAll('details[data-pon-details]').forEach(function(node) {
					if (node.open)
						opened[node.getAttribute('data-pon-details')] = true;
				});
				dom.content(dashboard, renderDashboard(status));
				dom.content(container, renderStatus(status));
				container.querySelectorAll('details[data-pon-details]').forEach(function(node) {
					node.open = opened[node.getAttribute('data-pon-details')] === true;
				});
			});
		}, 3);
		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
