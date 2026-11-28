// SPDX-License-Identifier: Apache-2.0

'use strict';
'require fs';
'require form';
'require ui';
'require uci';
'require view';

/* Printable ASCII keeps JavaScript character counts equal to wire byte counts. */
function validatePrintableAscii(value, minimum, maximum) {
	if (value == null || value === '')
		return true;

	if (!/^[\x20-\x7e]+$/.test(value))
		return _('Only printable ASCII characters are allowed.');

	if (value.length < minimum || value.length > maximum) {
		if (minimum === maximum)
			return _('The value must contain exactly %d bytes.').format(maximum);

		return _('The value must contain between %d and %d bytes.')
			.format(minimum, maximum);
	}

	return true;
}

function asciiLength(minimum, maximum) {
	return function(sectionId, value) {
		return validatePrintableAscii(value, minimum, maximum);
	};
}

function validateSerialNumber(sectionId, value) {
	if (value == null || value === '')
		return true;

	if (/^[0-9a-fA-F]{16}$/.test(value) ||
	    /^[A-Za-z0-9]{4}[0-9a-fA-F]{8}$/.test(value))
		return true;

	return _('Use 16 hexadecimal digits or VEND followed by 8 hexadecimal digits.');
}

function validateChipsetId(sectionId, value) {
	if (value == null || value === '' || /^[0-9a-fA-F]{16}$/.test(value))
		return true;

	return _('Use 16 hexadecimal digits.');
}

function isEponMode(mode) {
	return (mode || '').indexOf('epon-') === 0;
}

function sectionUsesEpon(sectionId) {
	var line = uci.get('pon', sectionId, 'line');

	return isEponMode(uci.get('pon', line, 'mode'));
}

function formatStorageSize(bytes) {
	var units = [ 'B', 'KiB', 'MiB', 'GiB' ];
	var size = Number(bytes);
	var unit = 0;

	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}

	return '%s %s'.format(size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1), units[unit]);
}

function parseStorageList(output) {
	var targets = JSON.parse(output);
	return Object.keys(targets).map(function(name) {
		var target = targets[name];
		return {
			id: name,
			label: '%s · %s · %s'.format(
				name, target.type.toUpperCase(), formatStorageSize(target.size))
		};
	});
}

/* Single-page guidance: replaces the upstream scattered tab layout. */
var PON_CONFIG_CSS =
	'.pon-quickstart{margin:8px 0 14px;padding:12px 16px;border-left:3px solid #4a90d9;' +
	'background:rgba(74,144,217,.08);border-radius:4px}' +
	'.pon-quickstart strong{display:block;margin-bottom:6px;font-size:1.05em}' +
	'.pon-quickstart ol{margin:4px 0 8px;padding-left:22px}' +
	'.pon-quickstart li{margin:3px 0}' +
	'.pon-quickstart p{margin:6px 0 0;opacity:.75;font-size:.92em}';

var PON_READY_CSS =
	'.pon-ready{margin:12px 0;padding:14px 16px;border-radius:8px;border:1px solid rgba(128,128,128,.25);' +
	'background:var(--background-color-primary,#fff)}' +
	'.pon-ready h3{margin:0 0 10px;font-size:15px}' +
	'.pon-ready-row{display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.9}' +
	'.pon-ready-ok{color:#1e8449;font-weight:bold}.pon-ready-no{color:#c0392b;font-weight:bold}' +
	'.pon-ready-hint{font-size:12px;color:var(--text-color-secondary,#888);margin:8px 0 0}' +
	'.pon-ready-action{margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
	'.pon-ready-go{background:#2ecc71;border-color:#27ae60;color:#fff;font-weight:600;padding:6px 18px}' +
	'@media(prefers-color-scheme:dark){.pon-ready{background:rgba(255,255,255,.05)}.pon-ready-ok{color:#2ecc71}.pon-ready-no{color:#e74c3c}}';

// Card-style polish for the form sections so the page reads as a guided
// wizard rather than a wall of upstream CBI rows.
var PON_FORM_CSS =
	'.pon-form .cbi-section{border:1px solid var(--border-color,rgba(0,0,0,.15));border-radius:10px;' +
	'margin:12px 0;padding:0;background:var(--background-color-primary,#fff);overflow:hidden}' +
	'.pon-form .cbi-section>h3,.pon-form .cbi-section>h4{margin:0;padding:12px 16px;font-size:14px;' +
	'background:rgba(74,144,217,.08);border-left:3px solid #4a90d9}' +
	'.pon-form .cbi-section .cbi-section-descr{padding:8px 16px 0;margin:0;font-size:12px;color:var(--text-color-secondary,#888)}' +
	'.pon-form .cbi-section table{width:100%}' +
	'.pon-form .cbi-section td{padding:8px 16px}' +
	'.pon-form .cbi-value{padding:8px 16px;border-top:1px solid rgba(128,128,128,.1)}' +
	'@media(prefers-color-scheme:dark){.pon-form .cbi-section{background:rgba(255,255,255,.05)}}';

// Informational snapshot of the current PON configuration. Deliberately does
// NOT gate the restart button: many ISPs (bridge mode, preset optics) need no
// LOID/SN at all, so a strict "readiness" check would block valid setups.
function readyNode() {
	var lines = uci.sections('pon', 'xpon');
	var line = lines && lines[0] || {};
	var mode = line.mode || '';
	var isEpon = mode.indexOf('epon-') === 0;
	var oam = uci.sections('pon', 'oam').filter(function(s) {
		return s.line === line['.name'];
	})[0] || {};

	var rows = [
		{ label: _('Line mode'), value: mode || _('driver default') },
		{ label: _('Serial number / driver default'), value: line.serial_number || _('driver default') }
	];
	if (isEpon)
		rows.push({ label: _('LOID'), value: oam.loid || _('not set') });

	var box = E('div', { 'class': 'pon-ready' }, [
		E('style', {}, PON_READY_CSS),
		E('h3', {}, _('Current PON configuration'))
	]);
	rows.forEach(function(r) {
		box.appendChild(E('div', { 'class': 'pon-ready-row' }, [
			E('strong', {}, r.label + ': '),
			E('span', {}, r.value)
		]));
	});
	box.appendChild(E('div', { 'class': 'pon-ready-hint' },
		_('No internet? After saving, restart PON to re-register. Most lines need only the mode; LOID/SN are ISP-specific.')));
	box.appendChild(E('div', { 'class': 'pon-ready-action' }, [
		E('button', {
			'class': 'cbi-button pon-ready-go',
			'type': 'button',
			'click': ui.createHandlerFn(this, function() {
				if (!window.confirm(_('Restart PON to apply the saved configuration and re-register?')))
					return;
				return this.handleRestartPon();
			})
		}, _('Restart PON')),
		E('span', { 'class': 'pon-ready-hint' },
			_('Make sure you clicked Save & Apply before restarting.'))
	]));
	return box;
}

function quickStartNode() {
	var steps = [
		_('1. Choose the line mode matching your ISP (XG-PON, XGS-PON or EPON).'),
		_('2. Enter the LOID and password issued by your ISP.'),
		_('3. Save & Apply, then restart the PON interface to register.')
	];

	return E('div', {}, [
		E('style', {}, PON_CONFIG_CSS),
		E('div', { 'class': 'pon-quickstart' }, [
			E('strong', {}, _('Quick start')),
			E('ol', {}, steps.map(function(text) {
				return E('li', {}, text);
			})),
			E('p', {}, _('All other fields can keep their defaults. Only change them if registration fails.'))
		])
	]);
}

return view.extend({
	load: function() {
		return fs.exec('/usr/libexec/airoha-pon-data', [ 'list' ]).then(function(result) {
			if (result.code != 0)
				throw new Error(result.stderr || result.stdout || _('Unable to list storage.'));

			var storages = parseStorageList(result.stdout);
			// Hardware identity is only available on boards exposing the helper.
			return L.resolveDefault(fs.stat('/tmp/pon-board-identity.available'), null)
				.then(function(st) {
					return { storages: storages, hasIdentity: st != null };
				});
		});
	},

	handleRestartPon: function() {
		var button = document.querySelector('.pon-ready-go');
		if (button) button.disabled = true;
		// Full line restart (pond stop -> down -> reapply -> pond start -> up).
		// A plain `/etc/init.d/pon restart` does not re-attach the datapath.
		return fs.exec_direct('/usr/libexec/airoha-pon-debug', [ 'restart' ]).then(function(output) {
			var result;
			try { result = JSON.parse(output); } catch (e) { result = null; }
			if (!result || result.ok !== true)
				throw new Error(_('PON restart failed.'));
			ui.addNotification(null, E('p', {},
				_('PON restarted. Check the status page to confirm registration.')));
		}).catch(function(error) {
			ui.addNotification(null, E('p', {},
				_('PON restart failed: %s').format(error.message)));
		}).finally(function() {
			if (button) button.disabled = false;
		});
	},

	handleBoardDataUpload: function(storages, selector) {
		var storage = storages[Number(selector.value)];

		return ui.uploadFile('/tmp/pon-board-data.bin').then(function() {
			return fs.exec('/usr/libexec/airoha-pon-data', [ 'write', storage.id ]).then(function(result) {
				if (result.code != 0)
					throw new Error(result.stderr || result.stdout || _('Write failed.'));

				var message = [
					_('Board data written to %s and verified. Reboot the device to apply it.')
						.format(storage.label)
				];
				if (result.stdout.trim())
					message.push(E('br'), result.stdout.trim());
				ui.addNotification(null, E('p', message));
			}).catch(function(error) {
				ui.addNotification(null, E('p', [
					_('Writing board data failed: %s').format(error.message)
				]));
			});
		});
	},

	render: function(data) {
		var m, s, o, selector;
		var storages = data.storages || [];

		m = new form.Map('pon', _('PON'),
			_('Configure the PON line on one page. Save & Apply at the bottom applies every section at once.'));
		m.readonly = !L.hasViewPermission();

		/* ---- Step 1: line mode (always visible) ---- */
		s = m.section(form.TypedSection, 'xpon', _('Step 1: Line mode'));
		s.anonymous = false;
		s.addremove = false;
		s.description = _('Pick the mode used by your ISP. Serial number and Registration-ID are usually printed on the optical module or provided by your ISP.');

		o = s.option(form.DummyValue, 'device', _('PON interface'));
		o.default = '-';

		o = s.option(form.ListValue, 'mode', _('Line mode'));
		o.default = '';
		o.value('', _('Driver default'));
		o.value('xgpon', _('XG-PON'));
		o.value('xgspon', _('XGS-PON'));
		o.value('epon-10g-1g', _('10G-EPON 10G/1G'));
		o.value('epon-10g-10g', _('10G-EPON 10G/10G'));
		o.description = _('XG-PON / XGS-PON are used by most FTTH lines; EPON modes are for 10G-EPON lines.');

		o = s.option(form.Value, 'serial_number', _('Serial number (SN)'));
		o.placeholder = _('Board serial number');
		o.rmempty = true;
		o.validate = validateSerialNumber;
		o.depends('mode', '');
		o.depends('mode', 'xgpon');
		o.depends('mode', 'xgspon');
		o.description = _('Usually printed on the optical module label. Leave empty to use the driver default.');

		o = s.option(form.Value, 'registration_id', _('Registration-ID'));
		o.password = true;
		o.rmempty = true;
		o.depends('mode', '');
		o.depends('mode', 'xgpon');
		o.depends('mode', 'xgspon');
		o.validate = asciiLength(1, 36);
		o.description = _('Optional; sent as all zeros when empty.');

		/* ---- Step 2a: XG-PON / XGS-PON identity (flat, no tabs) ---- */
		s = m.section(form.TypedSection, 'omci', _('Step 2: Registration & identity (XG-PON)'));
		s.anonymous = false;
		s.addremove = false;
		s.filter = function(sectionId) {
			return !sectionUsesEpon(sectionId);
		};
		s.description = _('Shown for XG-PON / XGS-PON lines. LOID and password come from your ISP; the remaining fields normally stay at their defaults.');

		o = s.option(form.DummyValue, 'line', _('XG-PON configuration'));
		o.default = '-';

		o = s.option(form.DummyValue, 'device', _('OMCI interface'));
		o.default = '-';

		o = s.option(form.Value, 'loid', _('LOID'));
		o.rmempty = true;
		o.validate = asciiLength(1, 24);
		o.description = _('Logical ONU ID issued by your ISP. Ask your installer or ISP support if unknown.');

		o = s.option(form.Value, 'loid_password', _('LOID password'));
		o.password = true;
		o.rmempty = true;
		o.validate = asciiLength(1, 12);
		o.description = _('Password paired with the LOID. Leave empty if your ISP does not use one.');

		o = s.option(form.Value, 'vendor_id', _('Vendor ID'));
		o.rmempty = true;
		o.validate = asciiLength(4, 4);
		o.description = _('Usually the same as the first four characters of the serial number.');

		o = s.option(form.Value, 'equipment_id', _('Equipment ID'));
		o.rmempty = true;
		o.validate = asciiLength(1, 20);

		o = s.option(form.Value, 'hardware_version', _('Hardware version'));
		o.rmempty = true;
		o.validate = asciiLength(1, 14);

		o = s.option(form.Value, 'software_version', _('Software version'));
		o.rmempty = true;
		o.validate = asciiLength(1, 14);

		o = s.option(form.Value, 'operator_id', _('Operator ID'));
		o.rmempty = true;
		o.validate = asciiLength(1, 4);

		o = s.option(form.ListValue, 'omcc_version', _('OMCC version'));
		o.value('0xb0', '0xb0');
		o.value('0x86', '0x86');
		o.default = '0xb0';
		o.rmempty = false;
		o.description = _('If the ONU cannot register with a Huawei OLT, try OMCC version 0x86.');

		o = s.option(form.Flag, 'disable_enhanced_security', _('Disable enhanced security (Class 332)'));
		o.default = '0';
		o.rmempty = true;

		o = s.option(form.Value, 'alloc_id_timeout', _('Alloc-ID wait timeout'));
		o.datatype = 'uinteger';
		o.placeholder = '30';
		o.rmempty = true;
		o.description = _('Seconds a data path may wait for PLOAM to assign its Alloc-ID before it is reported as failed. The ONU keeps waiting afterwards; 0 disables the timeout.');

		/* ---- Step 2b: EPON identity (flat, no tabs) ---- */
		s = m.section(form.TypedSection, 'oam', _('Step 2: Registration & identity (EPON)'));
		s.anonymous = false;
		s.addremove = false;
		s.filter = function(sectionId) {
			return sectionUsesEpon(sectionId);
		};
		s.description = _('Shown for EPON lines only. Choose the OAM profile first; LOID fields apply to the CTC profile.');

		o = s.option(form.DummyValue, 'line', _('EPON configuration'));
		o.default = '-';

		o = s.option(form.DummyValue, 'device', _('OAM interface'));
		o.default = '-';

		o = s.option(form.ListValue, 'operator', _('OAM profile'));
		o.default = 'ctc';
		o.value('ieee', _('IEEE 802.3ah'));
		o.value('ctc', _('IEEE 802.3ah + CTC'));

		o = s.option(form.Value, 'loid', _('LOID'));
		o.rmempty = true;
		o.depends('operator', 'ctc');
		o.validate = asciiLength(1, 24);

		o = s.option(form.Value, 'loid_password', _('LOID password'));
		o.password = true;
		o.rmempty = true;
		o.depends('operator', 'ctc');
		o.validate = asciiLength(1, 12);

		o = s.option(form.Value, 'vendor_id', _('Vendor ID'));
		o.rmempty = true;
		o.validate = asciiLength(4, 4);

		o = s.option(form.Value, 'model', _('ONU short model'));
		o.rmempty = true;
		o.validate = asciiLength(4, 4);

		o = s.option(form.Value, 'equipment_id', _('Equipment ID'));
		o.rmempty = true;
		o.validate = asciiLength(1, 16);

		o = s.option(form.Value, 'hardware_version', _('Hardware version'));
		o.rmempty = true;
		o.validate = asciiLength(1, 8);

		o = s.option(form.Value, 'software_version', _('Software version'));
		o.rmempty = true;
		o.validate = asciiLength(1, 16);

		o = s.option(form.Value, 'firmware_version', _('Firmware version'));
		o.rmempty = true;
		o.validate = asciiLength(1, 127);

		o = s.option(form.Value, 'chipset_id', _('Chipset ID'));
		o.rmempty = true;
		o.validate = validateChipsetId;

		o = s.option(form.Value, 'ge_ports', _('Ethernet port count'));
		o.default = '1';
		o.datatype = 'range(1,64)';

		return m.render().then(L.bind(function(map) {
			var body = [ quickStartNode(), readyNode() ];

			// Hardware identity is grouped here instead of a standalone tab.
			if (data.hasIdentity) {
				body.push(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Hardware identity')),
					E('p', {}, _('View and write the board serial numbers and MAC addresses. Changes require a reboot.')),
					E('a', {
						'class': 'cbi-button',
						'href': L.url('admin', 'network', 'pon', 'hardware')
					}, _('Open hardware identity editor'))
				]));
			}

			body.push(map);

			if (storages.length) {
				selector = E('select', { 'class': 'cbi-input-select' },
					storages.map(function(storage, index) {
						return E('option', { 'value': String(index) }, storage.label);
					}));

				body.push(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('PON board data')),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, _('Target storage')),
						E('div', { 'class': 'cbi-value-field' }, [
							selector,
							E('button', {
								'class': 'cbi-button cbi-button-action',
								'disabled': m.readonly || null,
								'click': ui.createHandlerFn(this, 'handleBoardDataUpload', storages, selector)
							}, [ _('Upload and write') ])
						])
					])
				]));
			}

			return E('div', { 'class': 'pon-form' }, [
				E('style', {}, PON_CONFIG_CSS + PON_READY_CSS + PON_FORM_CSS)
			].concat(body));
		}, this));
	}
});
