/* web worker to upload file */

/* slice the file into 1mb part, store each part in indexeddb while uploading
 * them until the last one. A hash is generated and sent to server in order
 * to compare after reassemble. metadata are sent with each chunk because why
 * not. A token must be requested before upload, this act as authentication.
 */

importScripts('kfilecache.js')
const Kache = new KFUCache()

const Uploader = new Worker('kfileuploader.js')
let NetDown = false
let Cancel = false
let KChunkSize = 1048576 // 1meg, max nginx post body size
self.onmessage = function (msg) {
    Cancel = false
    if (msg.data.operation) {
        switch(msg.data.operation) {
            case 'cancel':
                Uploader.postMessage({operation: 'cancel'})
                Cancel = true
                Kache.clear()
                break
            case 'init':
                if (msg.data.url) {
                    Uploader.postMessage({operation: 'init', url: msg.data.url})
                }
                if (msg.data.chunksize) {
                    KChunkSize = msg.data.chunksize
                }
                break

        }
        return
    }

    self.postMessage({operation: 'state', state: 'preparation', files: []})
    const file = msg.data.file
    file.arrayBuffer()
    .then(buffer => {
        return new Promise((resolve, reject) => {
            crypto.subtle.digest('sha-256', buffer)
            .then(hash => {
                resolve([hash, buffer])
            })
        })
    })
    .then(([hash, buffer]) => {
        let partCount = 0;
        const hashStr = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
        for (let i = 0; i < buffer.byteLength; i += KChunkSize) {
            if (Cancel) { break }
            const chunk = {
                hash: hashStr,
                count: partCount,
                max: Math.ceil(file.size / KChunkSize),
                size: KChunkSize,
                filename: file.name,
                filesize: file.size,
                filetype: file.type,
                token: msg.data.token,
                part: buffer.slice(i, i + KChunkSize),
                id: `${msg.data.token}-${partCount.toString().padStart(6, '0')}`
            }
            ++partCount
            Kache.add(chunk)
        }
        Cancel = false
    })
}

Uploader.onmessage = function (msg) {
    const content = msg.data
    switch (content.operation) {
        case 'state':
            if (!content.net) {
                NetDown = true
                self.postMessage({operation: 'state', state: 'disconnected', files: []})
                return 
            } else {
                NetDown = false
            }
            sendState()
            Kache.hasChunk(content.token)
            .then(num => {
                if (num === 0) {
                    Kache.rmToken(content.token)
                    .then(tk => {
                        if (tk === null) { return }
                        self.postMessage({operation: 'uploadDone', content: tk})
                    })
                }
            })
            break
    }
}

function sendState () {
    if (NetDown) {
        setTimeout(sendState, 1000)
        return
    }
    Kache.isEmpty()
    .then(empty => {
        if (empty) {
            self.postMessage({operation: 'state', state: 'none', files: []})
        } else {
            Kache.getProgress()
            .then(files => {
                if (files.length === 0) {
                    self.postMessage({operation: 'state', state: 'preparation', files: []})
                } else {
                    self.postMessage({operation: 'state', state: 'progress', files: files})
                }
                setTimeout(sendState, 1000)
            })
        }
    })
}

sendState()