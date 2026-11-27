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
// The luci-app-pon .apk is published in the firmware repo releases (same
// place as the sysupgrade images), NOT in the source-code fork which has no
// releases. GitHub API is often unreachable from mainland China, so try
// read-only mirrors in order. A user can force one source via UCI.
// NOTE: /releases/latest returns 404 for prereleases, and all our releases
// are marked prerelease. Use the full /releases list and pick the newest.
var DEFAULT_RELEASES = 'https://api.github.com/repos/likz0421/an7581-ci/releases?per_page=1';
var RELEASE_MIRRORS = [
	DEFAULT_RELEASES,
	'https://gh-proxy.com/https://api.github.com/repos/likz0421/an7581-ci/releases?per_page=1',
	'https://ghproxy.net/https://api.github.com/repos/likz0421/an7581-ci/releases?per_page=1'
];

function getConfig() {
	return {
		source: uci.get('pon', 'update', 'release_url') || '',
		mirrors: RELEASE_MIRRORS
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

function parseRelease(out, source) {
	if (!out || !out.trim())
		return null;
	var info;
	try {
		info = JSON.parse(out);
	} catch (error) {
		return null;
	}
	// /releases returns an array (newest first); /releases/latest returns one object.
	if (Array.isArray(info))
		info = info.filter(function(r) { return !r.draft; })[0];
	if (!info || !info.tag_name || !Array.isArray(info.assets))
		return null;
	// The release may carry a standalone luci-app-pon .apk (hot update) and/or
	// a sysupgrade firmware image. Accept either, prefer the apk for install.
	var apk = info.assets.filter(function(a) {
		return a.name.indexOf('luci-app-pon') >= 0 && a.name.indexOf('.apk') >= 0;
	})[0];
	var firmware = info.assets.filter(function(a) {
		return a.name.indexOf('squashfs-sysupgrade') >= 0 && a.name.indexOf('.itb') >= 0;
	})[0];
	if (!apk && !firmware)
		return null;
	var installAsset = apk || firmware;
	return {
		tag: info.tag_name,
		version: String(info.tag_name).replace(/^v/, ''),
		url: proxyDownloadUrl(installAsset.browser_download_url, source),
		name: installAsset.name,
		size: installAsset.size,
		isApk: !!apk,
		firmwareUrl: firmware ? proxyDownloadUrl(firmware.browser_download_url, source) : '',
		firmwareName: firmware ? firmware.name : '',
		notes: info.body || '',
		source: source
	};
}

// If the release JSON came through a proxy, route the .apk download through
// the same proxy so both requests work on the same network path.
function proxyDownloadUrl(downloadUrl, source) {
	if (!source || source.indexOf('ghproxy') < 0 && source.indexOf('gh-proxy') < 0)
		return downloadUrl;
	var prefix = source.split('/https://')[0];
	return prefix + '/https://' + downloadUrl.replace(/^https?:\/\//, '');
}

// Try the configured source first (if any), then built-in mirrors. Resolve
// with the first working response; only fail after all sources are exhausted.
function latestRelease(config) {
	var sources = config.source ? [ config.source ] : config.mirrors;
	var index = 0;
	function attempt() {
		if (index >= sources.length)
			return Promise.reject(new Error(_('Cannot reach the update server. Check the router Internet connection and the release URL.')));
		var source = sources[index++];
		// Plain busybox wget form covered by the rpcd ACL (no timeout prefix).
		return fs.exec_direct(BUSYBOX, [ 'wget', '-q', '-O', '-', source ]).then(function(out) {
			var parsed = parseRelease(out, source);
			if (parsed)
				return parsed;
			return attempt();
		}).catch(function() {
			return attempt();
		});
	}
	return attempt();
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
			L.resolveDefault(latestRelease(cfg), null)
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
		Promise.all([ currentVersion(), latestRelease(cfg) ]).then(function(results) {
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

		latestRelease(cfg).then(function(release) {
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
		var actions = [
			E('button', {
				'class': 'cbi-button',
				'id': 'pon-update-check',
				'type': 'button',
				'click': ui.createHandlerFn(this, 'handleCheck')
			}, _('Check again'))
		];
		if (data.latest) {
			rows.push(
				row(_('Latest release'), data.latest.tag),
				row(_('Asset'), data.latest.name),
				row(_('Size'), String(data.latest.size || '-')),
				row(_('Update type'), data.latest.isApk ? _('PON plugin hot update') : _('Full firmware (PON built in)')),
				row(_('Source'), data.latest.source || data.cfg.source || _('Built-in mirror'))
			);
			if (data.latest.firmwareUrl)
				rows.push(row(_('Firmware download'), E('a', {
					'href': data.latest.firmwareUrl, 'target': '_blank', 'rel': 'noopener'
				}, data.latest.firmwareName)));
			if (data.latest.notes)
				rows.push(row(_('Release notes'), String(data.latest.notes).slice(0, 400)));
			if (data.latest.isApk) {
				actions.push(E('button', {
					'class': 'cbi-button cbi-button-action',
					'type': 'button',
					'click': ui.createHandlerFn(this, 'handleInstall')
				}, _('Download and install plugin')));
			} else {
				rows.push(row(_('How to update'),
					_('PON is built into the firmware. Download the sysupgrade image above and flash it in System → Backup / Flash Firmware.')));
			}
		} else {
			rows.push(row(_('Latest release'), _('Unavailable')));
		}
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Update status')),
			E('table', { 'class': 'table' }, rows),
			E('div', { 'class': 'cbi-page-actions' }, actions)
		]);
	},

	render: function(data) {
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('PON online update')),
			E('p', { 'class': 'cbi-section-descr' },
				_('Checks the installed version and installs the newest package online. Several read-only mirrors are tried automatically if GitHub is unreachable; set UCI pon.update.release_url to force one specific source.')),
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
