/* web worker to upload file */

/* slice the file into 1mb part, store each part in indexeddb while uploading
 * them until the last one. A hash is generated and sent to server in order
 * to compare after reassemble. metadata are sent with each chunk because why
 * not. A token must be requested before upload, this act as authentication.
 */

importScripts('kfilecache.js')
const Kache = new KFUCache()
let Cancel = false

self.onmessage = function (msg) {
    const content = msg.data

    switch(content.operation) {
        case 'cancel':
            Cancel = true;
            break
    }
}

function sendChunk (idb, chunkKey) {
    return new Promise((resolve, reject) => {
        const tr = idb.transaction('UploadCache', 'readonly')
        .objectStore('UploadCache')
        .get(chunkKey)
        tr.onsuccess = function (event) {
            const chunk = event.target.result
            if (!event.target.result) {
                reject()
                return;
            }
            const headers = new Headers()
            headers.append('x-kfu-chunk-count', chunk.count)
            headers.append('x-kfu-chunk-max', chunk.max)
            headers.append('x-kfu-chunk-size', chunk.size)
            headers.append('x-kfu-filename', chunk.filename)
            headers.append('x-kfu-filesize', chunk.filesize)
            headers.append('x-kfu-filetype', chunk.filetype)
            headers.append('x-kfu-token', chunk.token)
            headers.append('x-kfu-hash', chunk.hash)
            headers.append('x-kfu-path', chunk.path)
            fetch('../../../web/upload.php', {method: 'POST', body: chunk.part, headers: headers})
            .then (response => {
                if (!response.ok) { reject(); return }
                return response.json()
            })
            .then(result => {
                if (result.id === chunkKey) {
                    resolve([chunk, result])
                    return
                }
                reject()
            })
            .catch(e => {
                reject()
            })
        }
    })
}

function iterateChunks (idb) {
    return new Promise((resolve, reject) => {
        if (Cancel) {
            resolve([idb, []])
            return
        }
        const UPLOAD_KEYS = []
        const tr = idb.transaction('UploadCache', 'readonly')
        .objectStore('UploadCache')
        .openKeyCursor()
        tr.onsuccess = function (event) {
            const cursor = event.target.result
            if (cursor) {
                const key = cursor.key
                if (UPLOAD_KEYS.length > 10) { resolve([idb, UPLOAD_KEYS]); return; }
                if (UPLOAD_KEYS.indexOf(key) !== -1) { cursor.continue(); return; }
                UPLOAD_KEYS.push(key)
                if (UPLOAD_KEYS.length < 10) {
                    cursor.continue()
                } else {
                    resolve([idb, UPLOAD_KEYS])
                    return
                }
            } else {
                resolve([idb, UPLOAD_KEYS])
                return
            }
        }
    })
}

function uploadChunks (idb, UPLOAD_KEYS) {
    return new Promise((resolve, reject) => {
        const uploads = []
        while(key = UPLOAD_KEYS.pop()) {
            uploads.push(
                sendChunk(idb, key)
                .then (([chunk, result]) => {       
                    if (!result.id) {
                        return [false, key]
                    } else {
                        return Kache.remove(chunk)
                    }
                })
                .then(token => {
                    if (!token) { return [false, key] }
                    return Kache.hasChunk(token) 
                    .then (num => {
                        self.postMessage({operation: 'state', token: token, left: num, net: true})
                        return [true, key]
                    })
                })
                .catch(e => {
                    return [false, key]
                })
            )
        }
        Promise.allSettled(uploads)
        .then(results => {
            /* if at least one succeed, we have net connection, else we don't */
            let success = false
            results.forEach(result => {
                if (result.value[0]) { success = true}
            })
            if(!success && results.length > 0 && !Cancel) { self.postMessage({operation: 'state', token: null, left: 0, net: false}) }
            resolve(success)
        })
    })
}

let running = false
/* on start, empty */
function run () {
    if (running) { setTimeout(run, 2000); return; }
    running = true
    Kache.open()
    .then(idb => {
        return iterateChunks(idb)
    })
    .then(([idb, keys]) => {
        return uploadChunks(idb, keys)
    })
    .then(success => {
        if (!success) { return true; }
        return Kache.isEmpty()
    })
    .then(empty => {
        running = false
        if (empty) { Cancel = false; setTimeout(run, 2000) }
        else { run() }
    })
    .catch(_ => {
        running = false
        setTimeout(run, 2000)
    })
}

run()