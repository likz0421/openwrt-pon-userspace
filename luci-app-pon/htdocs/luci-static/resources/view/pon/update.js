// SPDX-License-Identifier: Apache-2.0
// Online update for the PON web UI. Checks the current ponctl version, queries
// a configurable GitHub releases endpoint, downloads the newest luci-app-pon
// package and installs it. Every step is explicit and confirmable.
'use strict';
'require dom';
'require fs';
'require ui';
'require uci';
'require view';

var PONCTL = '/usr/sbin/ponctl';
var BUSYBOX = '/bin/busybox';
var APK = '/usr/bin/apk';
var TMP_APK = '/tmp/luci-app-pon-online.apk';
var DEFAULT_RELEASES = 'https://api.github.com/repos/likz0421/openwrt-pon-userspace/releases/latest';

function getConfig() {
	return {
		source: uci.get('pon', 'update', 'release_url') || DEFAULT_RELEASES
	};
}

function currentVersion() {
	return L.resolveDefault(fs.exec_direct(PONCTL, [ 'version', '--json' ]), null).then(function(out) {
		try {
			var info = JSON.parse(out);
			return info.version || _('unknown');
		} catch (e) {
			return _('unknown');
		}
	});
}

function latestRelease(source) {
	// BusyBox wget has no built-in timeout option; wrap with busybox's own
	// timeout applet so an unreachable GitHub cannot hang the whole page.
	return fs.exec_direct(BUSYBOX, [ 'timeout', '20', 'wget', '-q', '-O', '-', source ]).then(function(out) {
		if (!out || !out.trim())
			throw new Error(_('Cannot reach the update server. Check the router Internet connection and the release URL.'));
		var info;
		try {
			info = JSON.parse(out);
		} catch (error) {
			throw new Error(_('Update server returned an invalid response (not JSON). Check the release URL: %s').format(source));
		}
		if (!info.tag_name || !Array.isArray(info.assets))
			throw new Error(_('Unexpected release response'));
		var asset = info.assets.filter(function(a) {
			return a.name.indexOf('luci-app-pon') >= 0 && a.name.indexOf('.apk') >= 0;
		})[0];
		if (!asset)
			throw new Error(_('No luci-app-pon package in the latest release'));
		return {
			tag: info.tag_name,
			version: String(info.tag_name).replace(/^v/, ''),
			url: asset.browser_download_url,
			name: asset.name,
			size: asset.size,
			notes: info.body || ''
		};
	});
}

function downloadPackage(url) {
	return fs.exec_direct(BUSYBOX, [ 'wget', '-q', '-O', TMP_APK, url ]).then(function() {
		return fs.exec_direct('/usr/bin/sha256sum', [ TMP_APK ]);
	}).then(function(sum) {
		return sum.trim().split(/\s+/)[0];
	});
}

return view.extend({
	load: function() {
		var cfg = getConfig();
		return Promise.all([
			currentVersion(),
			L.resolveDefault(latestRelease(cfg.source), null)
		]).then(function(results) {
			return {
				cfg: cfg,
				current: results[0],
				latest: results[1]
			};
		});
	},

	handleCheck: function() {
		var button = document.getElementById('pon-update-check');
		button.disabled = true;
		var cfg = getConfig();
		Promise.all([ currentVersion(), latestRelease(cfg.source) ]).then(function(results) {
			dom.content(document.getElementById('pon-update-result'), this.renderResult({
				cfg: cfg, current: results[0], latest: results[1]
			}));
		}.bind(this)).catch(function(error) {
			dom.content(document.getElementById('pon-update-result'),
				E('p', { 'class': 'alert-message warning' },
					_('Update check failed: %s').format(error.message)));
		}).finally(function() {
			button.disabled = false;
		});
	},

	handleInstall: function(ev) {
		var cfg = getConfig();
		var self = this;
		var button = ev.currentTarget;
		button.disabled = true;

		latestRelease(cfg.source).then(function(release) {
			if (!window.confirm(_('Download and install %s (%s)?').format(release.tag, release.name)))
				return null;
			ui.addNotification(null, E('p', {}, _('Downloading %s …').format(release.name)));
			return downloadPackage(release.url).then(function(sha) {
				if (window.confirm(_('Downloaded %s (sha256 %s). Install now?').format(release.name, sha.slice(0, 16)))) {
					return fs.exec_direct(APK, [ 'add', '--allow-untrusted', TMP_APK ]).then(function() {
						ui.addNotification(null, E('p', {},
							_('PON package installed. Refresh the page; if LuCI looks broken, reload firmware.')));
					});
				}
			});
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, _('Update failed: %s').format(error.message)));
		}).finally(function() {
			button.disabled = false;
		});
	},

	renderResult: function(data) {
		var rows = [
			row(_('Installed version'), data.current)
		];
		if (data.latest) {
			rows.push(
				row(_('Latest release'), data.latest.tag),
				row(_('Package'), data.latest.name),
				row(_('Size'), String(data.latest.size || '-')),
				row(_('Source'), data.cfg.source)
			);
			if (data.latest.notes)
				rows.push(row(_('Release notes'), String(data.latest.notes).slice(0, 400)));
		} else {
			rows.push(row(_('Latest release'), _('Unavailable')));
		}
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Update status')),
			E('table', { 'class': 'table' }, rows),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'cbi-button',
					'id': 'pon-update-check',
					'type': 'button',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('Check again')),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'type': 'button',
					'disabled': data.latest ? null : true,
					'click': ui.createHandlerFn(this, 'handleInstall')
				}, _('Download and install'))
			])
		]);
	},

	render: function(data) {
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('PON online update')),
			E('p', { 'class': 'cbi-section-descr' },
				_('Check the installed PON version against the latest release and install the new package online. The update source can be changed under UCI pon.update.release_url.')),
			E('div', { 'id': 'pon-update-result' }, this.renderResult(data)),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Fallback: local package')),
				E('p', {}, _('If online access fails, install a locally downloaded luci-app-pon .apk package here.')),
				E('input', { 'type': 'file', 'id': 'pon-local-apk', 'accept': '.apk' }),
				E('button', {
					'class': 'cbi-button',
					'type': 'button',
					'click': ui.createHandlerFn(this, 'handleLocalInstall')
				}, _('Install local package'))
			])
		]);
	},

	handleLocalInstall: function() {
		var input = document.getElementById('pon-local-apk');
		var file = input && input.files && input.files[0];
		if (!file || file.name.indexOf('luci-app-pon') < 0 || file.name.indexOf('.apk') < 0)
			return ui.addNotification(null, E('p', {}, _('Only luci-app-pon .apk files are accepted.')));
		if (!window.confirm(_('Install the selected local PON package?')))
			return;
		return ui.uploadFile(TMP_APK).then(function() {
			return fs.exec_direct(APK, [ 'add', '--allow-untrusted', TMP_APK ]);
		}).then(function() {
			ui.addNotification(null, E('p', {}, _('PON package installed. Refresh the page.')));
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, _('Install failed: %s').format(error.message)));
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width: 35%' }, label),
		E('td', { 'class': 'td left' }, value == null || value === '' ? _('unknown') : String(value))
	]);
}
