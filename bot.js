const https = require('https')
const fs = require('fs')
const ip = require('ip')
const ipRange = require('ip-subnet-calculator')
const whois = require('whois-ux')
const ini = require("ini");

const telegram = {
    host: 'api.telegram.org',
}

function formatStr() {
    if(arguments.length) {
        let num = 0
        let args = arguments
        return arguments[0].replace(/%s/g, function(){ return args[++num] })
    } return ""
}

class telegramBot {
    #uid = ''
    #event = {}

    constructor(uid) {
        this.#uid = uid
    }

    handler(job) {
        try {
            console.log(job)
        } catch(error) {
            console.log(error.message)
        }
    }

    rawData(raw) {
        try {
            let data, type
            if ((data = JSON.parse(raw)) !== false && (type = this.getMessageType(data)) !== false) {
                switch (type) {
                    case 'text':
                            this.onText(data);
                        break
                }
                console.log(formatStr("id: %s, from %s",
                    data.message.message_id,
                    data.message.from.username
                ))
            }
        } catch(error) {
            console.log(error.message)
        }
    }

    on(message, func, isPublic) {
        if (!!!this.#event[message]) {
            this.#event[message] = {
                regexp: message,
                func: func,
                public: isPublic||false
            }
        } else {
            console.log(formatStr("error, event already registered: %s", message))
        }
    }

    onText(data) {
        if (Object.keys(this.#event).length) {
            for (const [template, event] of Object.entries(this.#event)) {
                if (!event.public && data.message.chat.type !== 'private') {
                    continue
                } else {
                    let match = data.message.text.match(event.regexp)
                    if (match) {
                        try {
                            event.func(data, match)
                            return true
                        } catch(error) {
                            console.log("error in custom event function: [%s] %s", template, error.message)
                        }
                        break
                    }
                }
            }
            //console.log("No matches found in the dictionary")
        }
        return false
    }

    getMessageType(obj) {
        if (!!obj.message) {
            if (!!obj.message.text)     return 'text'
            if (!!obj.message.photo)    return 'photo'
            if (!!obj.message.sticker)  return 'sticker'
            if (!!obj.message.document) return 'document'
        }
        return false
    }

    send(type, template) {
        try {
            let data = JSON.stringify(template)
    
            const answer = https.request({
                hostname: telegram.host,
                port: 443,
                path: formatStr('/bot%s/%s', this.#uid, type),
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': data.length
                }
            }, (response) => {
                let raw = ''
                response.on('data', (buf) => { raw += buf })
                response.on('end',  (   ) => {
                    //console.log(raw)
                })
            })
    
            answer.write(data)
            answer.end()
        } catch(error) {
            console.log(error.message)
        }
    }
    
    sendMessage(id, message) {
        try {
            this.send('sendMessage', {
                chat_id: id,
                parse_mode: 'HTML',
                text: message
            })
        } catch(error) {
            console.log(error.message)
        }
    }

    sendLocation(id, lat, lon) {
        try {
            this.send('sendLocation', {
                chat_id: id,
                latitude: lat,
                longitude: lon
            })
        } catch(error) {
            console.log(error.message)
        }
    }
}

let config = ini.parse(fs.readFileSync("config.ini", "utf-8"))
let bot = new telegramBot(config.bot.token)

bot.on(new RegExp(/ipcalc\s+((:?\d+\.){3}\d+\/(\d+|(:?\d+\.){3}\d+))/, "i"), (data, match) => {
    let message = ''
    try {
        let info = ip.cidrSubnet(match[1])
        message = formatStr("<pre>Network: %s/%s\nNetmask: %s\nHostMin: %s\nHostMax: %s\nBroadcast: %s\nSize: %s</pre>",
            info.networkAddress,
            info.subnetMaskLength,
            info.subnetMask,
            info.firstAddress,
            info.lastAddress,
            info.broadcastAddress,
            info.numHosts
        )
    } catch(error) {
        message = "Ooooh, no! Try to do it yourself"
    }
    bot.sendMessage(data.message.chat.id, message)
}, true)

bot.on(new RegExp(/whois\s+((\w+\.)+\w+)/i), (data, match) => {     
    let message = ''
    try {
        // Private network
        if (ip.isPrivate(match[1])) {
            bot.sendMessage(data.message.chat.id, "Ooooh, no, no, no ..!")
        } else {
            require('http').request({
                host: 'ip-api.com',
                path: formatStr("/json/%s?%s", match[1], 'status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,org,as,query')
            }, (response) => {
                let raw = ''
                response.on('data', (buf) => { raw += buf })
                response.on('end',  (   ) => {
                    let info = JSON.parse(raw)
                    if (info.status === "success") {
                        message = formatStr("%s\n%s (%s/%s)\nTimezone: %s\nISP: %s",
                            info.org,
                            info.country,
                            info.regionName,
                            info.city,
                            info.timezone,
                            info.isp
                        )
                        whois.whois(info.query, (error, whraw) => {
                            if (!error) {
                                let subnet = ''
                                // CIDR
                                if (!!whraw.CIDR2) {
                                    for (const net of whraw.CIDR) {
                                        if (subnet.length) subnet += "\n"
                                        subnet += net
                                    }
                                // netRange
                                } else if (!!whraw.NetRange) {
                                    for (const net of whraw.NetRange) {
                                        let match = net.match(/((\d+\.){3}\d+)\s+-\s+((\d+\.){3}\d+)/)
                                        if (match) {
                                            address = ipRange.calculate(match[1], match[3])
                                            if (subnet.length) subnet += "\n"
                                            subnet += formatStr("%s/%s", address[0].ipLowStr, address[0].prefixSize)
                                        }
                                    }
                                // route
                                } else if (!!whraw.route2) {
                                    switch (typeof whraw.route) {
                                        case 'object':
                                            for (const net of whraw.route) {
                                                if (subnet.length) subnet += "\n"
                                                subnet += net
                                            }
                                            break
                                        case 'string':
                                                subnet += whraw.route
                                            break
                                    }
                                // inetnum
                                } else if (!!whraw.inetnum) {
                                    let match = whraw.inetnum.match(/((\d+\.){3}\d+)\s+-\s+((\d+\.){3}\d+)/)
                                    if (match) {
                                        address = ipRange.calculate(match[1], match[3])
                                        subnet = formatStr("%s/%s", address[0].ipLowStr, address[0].prefixSize)
                                    }
                                }
    
                                if (subnet.length) {
                                    message += formatStr("\n%s", subnet)
                                }
                            }
                            bot.sendLocation(data.message.chat.id, info.lat, info.lon)
                            bot.sendMessage(data.message.chat.id, formatStr("<pre>%s</pre>", message))
                        })
                    } else {
                        bot.sendMessage(data.message.chat.id, formatStr(":( - %s", info.message))
                    }                    
                })
            }).end()
        }
    } catch (error) {
        console.log(error.message)
    }
}, true)

https.createServer({
//    requestCert: false,
//    rejectUnauthorized: false
//    key:  fs.readFileSync('keys/le/privkey.pem'),
//    cert: fs.readFileSync('keys/le/cert.pem'),
//    ca:   fs.readFileSync('keys/le/chain.pem')
    key:  fs.readFileSync('keys/private.key'),
    cert: fs.readFileSync('keys/public.pem'),
}, (req, res) => {
    if (req.url === '/telegram') {
        let data = ''
        req.on('data', (buf) => { data += buf })
        req.on('end',  (   ) => { 
            bot.rawData(data)
            res.writeHead(200)
            res.end()
        })
    }
}).listen(8443)