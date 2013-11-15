var crypto = require('crypto')
, debug = require('debug')('snow:users:create')

module.exports = exports = function(app) {
    exports.app = app

    app.post('/v1/users', exports.beginCreate)
    app.post('/v1/users/verify/:code([a-f0-9]{20})', exports.endCreate)

    // Legacy, remove after 2014-01-01
    app.get('/v1/email/verify/:code([a-f0-9]{20})', exports.endCreate)
}

exports.code = function() {
    return crypto.randomBytes(10).toString('hex')
}

exports.beginCreate = function(req, res, next) {
    if (!req.app.validate(req.body, 'v1/user_begin_create', res)) return

    var code = exports.code()

    debug('correct email verify code for %s: %s', code, req.body.email)

    req.app.conn.write.query({
        text: [
            'INSERT INTO user_pending (email, api_key_id, code)',
            'VALUES ($1, $2, $3)'
        ].join('\n'),
        values: [req.body.email, req.body.key, code]
    }, function(err) {
        if (err) {
            if (err.code == '23505' || err.message == 'Email already in use') {
                return res.send(400, {
                    name: 'EmailAlreadyInUse',
                    message: 'The specified email is already in use'
                })
            }

            return next(err)
        }

        var language = 'en-US'

        if (/(nb|no)/i.exec(req.get('Accept-Language'))) {
            language = 'nb-NO'
        }

        req.app.email.send(req.body.email, language, 'verify-email', { code: code }, function(err) {
            if (err) return next(err)
            res.send(204)
        })
    })
}

exports.endCreate = function(req, res, next) {
    req.app.conn.write.query({
        text: 'SELECT create_user_end($1) user_id',
        values: [req.params.code]
    }, function(err, dr) {
        if (err) {
            if (err.message == 'Unknown email verification code') {
                return res.send(409, {
                    name: 'UnknownEmailVerifyCode',
                    message: 'The email is already verified or the code has been expired'
                })
            }
            return next(err)
        }

        req.app.segment.track({
            userId: dr.rows[0].user_id.toString(),
            event: 'Signed up'
        })

        res.send(204)
    })
}
