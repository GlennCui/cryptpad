/*jshint esversion: 6 */
/* globals Buffer*/
const Quota = module.exports;

//const Util = require("../common-util");
const Keys = require("../keys");
const Package = require('../../package.json');
const Https = require("https");

Quota.isValidLimit = function (o) {
    var valid = o && typeof(o) === 'object' &&
        typeof(o.limit) === 'number' &&
        typeof(o.plan) === 'string' &&
        typeof(o.note) === 'string' &&
        // optionally contains a 'users' array
        (Array.isArray(o.users) || typeof(o.users) === 'undefined');

    return valid;
};

Quota.applyCustomLimits = function (Env) {
    // DecreedLimits > customLimits > serverLimits;

    // XXX perform an integrity check on shared limits
    // especially relevant because we use Env.limits
    // when considering whether to archive inactive accounts

    // read custom limits from the Environment (taken from config)
    var customLimits = (function (custom) {
        var limits = {};
        Object.keys(custom).forEach(function (k) {
            var user;
            try {
                user = Keys.parseUser(k);
            } catch (err) {
                return void Env.Log.error("PARSE_CUSTOM_LIMIT_BLOCK", {
                    user: k,
                    error: err.message,
                });
            }

            var unsafeKey = user.pubkey;
            limits[unsafeKey] = custom[k];
        });
        return limits;
    }(Env.customLimits || {}));

    Env.limits = Env.limits || {};
    Object.keys(customLimits).forEach(function (k) {
        if (!Quota.isValidLimit(customLimits[k])) { return; }
        Env.limits[k] = customLimits[k];
    });
    // console.log(Env.limits);
};

/*
Env = {
    myDomain,
    mySubdomain,
    adminEmail,
    Package.version,

};
*/
Quota.queryAccountServer = function (Env, cb) {
    cb = cb; // XXX
};

Quota.updateCachedLimits = function (Env, cb) {
    Quota.applyCustomLimits(Env);
    if (Env.blockDailyCheck === true ||
        (typeof(Env.blockDailyCheck) === 'undefined' && Env.adminEmail === false && Env.allowSubscriptions === false)) {
        return void cb();
    }

    var body = JSON.stringify({
        domain: Env.myDomain,
        subdomain: Env.mySubdomain || null,
        adminEmail: Env.adminEmail,
        version: Package.version
    });
    var options = {
        host: 'accounts.cryptpad.fr',
        path: '/api/getauthorized',
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body)
        }
    };

    var req = Https.request(options, function (response) {
        if (!('' + response.statusCode).match(/^2\d\d$/)) {
            return void cb('SERVER ERROR ' + response.statusCode);
        }
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            try {
                var json = JSON.parse(str);
                // don't overwrite the limits with junk data
                if (json && json.message === 'EINVAL') { return void cb(); }

                Env.limits = json;
                Quota.applyCustomLimits(Env);
        //console.log('Env.customLimits', Env.customLimits);
        //console.log('Env.limits', Env.limits);
                cb(void 0);
            } catch (e) {
                cb(e);
            }
        });
    });

    req.on('error', function (e) {
        Quota.applyCustomLimits(Env);
        if (!Env.myDomain) { return cb(); }
        // only return an error if your server allows subscriptions
        cb(e);
    });

    req.end(body);
};

// The limits object contains storage limits for all the publicKey that have paid
// To each key is associated an object containing the 'limit' value and a 'note' explaining that limit
Quota.getUpdatedLimit = function (Env, safeKey, cb) { // FIXME BATCH?S
    Quota.updateCachedLimits(Env, function (err) {
        if (err) { return void cb(err); }

        var limit = Env.limits[safeKey];

        if (limit && typeof(limit.limit) === 'number') {
            return void cb(void 0, [limit.limit, limit.plan, limit.note]);
        }

        return void cb(void 0, [Env.defaultStorageLimit, '', '']);
    });
};

