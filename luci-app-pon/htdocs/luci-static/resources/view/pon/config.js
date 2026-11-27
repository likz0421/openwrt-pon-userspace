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

			return parseStorageList(result.stdout);
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

	render: function(storages) {
		var m, s, o, selector;

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
			var body = [ quickStartNode(), map ];

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

			return E([], body);
		}, this));
	}
});
