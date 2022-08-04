function KFUCache () {
    this.IDB = false
}

KFUCache.prototype.open = function () {
    return new Promise ((resolve, reject) => {

        if (this.IDB) {
            resolve(this.IDB)
            return
        }

        const IDB = indexedDB.open('KFUChunkCache', 1)
        IDB.onupgradeneeded = (event)  => {
            const idb = event.target.result
            const upcache = idb.createObjectStore('UploadCache', {keyPath: 'id'})
            upcache.createIndex('idxToken', 'token', {unique: false})
            const tokens = idb.createObjectStore('Tokens', {keyPath: 'token'})
            upcache.transaction.oncomplete = (event) => {
                this.IDB = event.target.result
                resolve(this.IDB)
            }
            upcache.transaction.onerror = (event) => {
                this.IDB = false
                reject(event)
            }
            upcache.transaction.oncomplete = (event) => {
                this.IDB = event.target.result
                resolve(this.IDB)
            }
        }

        IDB.onsuccess = (event) => {
            this.IDB = event.target.result
            resolve(this.IDB)
        }

        IDB.onerror = (event) => {
            this.IDB = false
            reject(event)
        }
    })
}

KFUCache.prototype.add = function (chunk) {
    return new Promise((resolve, reject) => {
        if (!chunk.id) { reject(); return }
        this.open()
        .then(idb => {
            chunk.failCount = 0
            const tr = idb.transaction(['UploadCache'], 'readwrite')
            const addReq = tr.objectStore('UploadCache')
                .add(chunk)

            tr.onerror = function (event) {
                event.target.abort()
            }
            tr.oncomplete = function (event) {
            }

            addReq.onsuccess = (event) => {
                this.issetToken(chunk.token)
                .then(isset => {
                    if (!isset) {
                        this.setToken(
                            chunk.token, {
                                token: chunk.token,
                                start: new Date(),
                                path: chunk.path,
                                filename: chunk.filename,
                                filesize: chunk.filesize,
                                max: chunk.max,
                                hash: chunk.hash
                            })
                        .then(_ => {
                            resolve()
                        })
                    } else {
                        resolve()
                    }
                })
            }

            addReq.onerror = function (event) {
                event.target.transaction.abort()
                reject()
            }

        })
    })
}

KFUCache.prototype.isEmpty = function () {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction('UploadCache', 'readonly')
            const upcache = tr.objectStore('UploadCache')
                .count()

            upcache.onsuccess = function (event) {
                resolve(event.target.result === 0)
            }
            upcache.onerror = function (event) {
                resolve(true)
            }
        })
    })
}

KFUCache.prototype.remove = function (chunk) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction('UploadCache', 'readwrite')
                            
            const upcache = tr.objectStore('UploadCache')
                .delete(chunk.id)
            upcache.onsuccess = function (event) {
                tr.commit()
                resolve(chunk.token)
            }
            tr.onerror = function (event) {
                event.target.abort()
                reject(event)
            }
        })
    })
}

KFUCache.prototype.issetToken = function (token) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction(['Tokens'], 'readonly')
            const getRequest = tr.objectStore('Tokens')
                .get(token)
            getRequest.onsuccess = function (event) {
                if (event.target.result === undefined) {
                    resolve(false)
                } else {
                    resolve(true)
                }
            }
        })
    })
}

KFUCache.prototype.setToken = function (token, mod) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction(['Tokens'], 'readwrite')
            const getRequest = tr.objectStore('Tokens').get(token)
            getRequest.onsuccess = function (event) {
                const old = event.target.result || {}
                for (const k in mod) {
                    old[k] = mod[k]
                }
                old.token = token
                const setRequest = tr.objectStore('Tokens').put(old)
                setRequest.onsuccess = function (event) {
                    event.target.transaction.commit()
                    resolve(old)
                }
            }
        })
    })
}

KFUCache.prototype.hasChunk = function (token) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction(['UploadCache'], 'readonly')
            const req = tr.objectStore('UploadCache')
                .index('idxToken')
                .count(token)

            req.onsuccess = function (event) {
                resolve(event.target.result)
                tr.commit()
            }
            req.onerror = function (event) {
                reject()
            }
        })
    })
}

KFUCache.prototype.rmToken = function (token) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction(['Tokens'], 'readwrite')
            const tok = tr.objectStore('Tokens')
                .get(token)

            tok.onsuccess = function (event) {
                const tr = event.target.transaction
                const result = event.target.result
                if (result === undefined) {
                    resolve(null)
                    tr.commit()
                    return
                }
                resolve(result)
                tr.objectStore('Tokens')
                    .delete(token)
            }
        })
    })
}

KFUCache.prototype.incFail = function (key) {
    return new Promise((resolve, reject) => {
        const tr = this.IDB.transaction(['UploadCache'], 'readwrite')
        const req = tr.objectStore('UploadCache')
            .get(key)
        req.onsuccess = function (event) {
            const chunk = event.target.result
            if (chunk === undefined) { tr.commit(); return }
            if (chunk.failCount === undefined) {
                chunk.failCount = 1
            } else {
                chunk.failCount++
            }

            const req = event.target.transaction.objectStore('UploadCache')
                .put(chunk)

            req.onsuccess = this.trSuccess
            req.onerror = this.trFail
        }
        req.onerror = this.trFail
    })
}

KFUCache.prototype.trFail = function (event) {
    event.target.transaction.abort()
    if (reject) { reject(new Error('Transaction failed')) }
}

KFUCache.prototype.trSuccess = function (event) {
    event.target.transaction.commit()
    if (resolve) { resolve(event.target.result) }
}

KFUCache.prototype.getProgress = function () {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const trTok = idb.transaction(['Tokens'], 'readonly')
            const reqTok = trTok.objectStore('Tokens')
                .getAll()

            reqTok.onsuccess = (event) => {
                const progress = []
                const tokSet = event.target.result
                for(const tok of tokSet) {
                    progress.push(
                        new Promise((resolve, reject) => {
                            this.hasChunk(tok.token)
                            .then(num => {
                                tok.progress = 100 - Math.round(num * 100 / tok.max)
                                tok.left = num
                                resolve(tok)
                            })
                        })
                    )
                }
            

                Promise.all(progress)
                .then(result => {
                    resolve(result)
                })
            }
        })
    })
}

KFUCache.prototype.clear = function () {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction(['Tokens', 'UploadCache'], 'readwrite')
            const reqChunk = tr.objectStore('UploadCache')
                .openCursor()

            reqChunk.onsuccess = function (event) {
                const tr =  event.target.transaction
                const cursor = event.target.result

                if (!cursor) {
                    const reqTk = tr.objectStore('Tokens')
                        .openCursor()
                    reqTk.onsuccess = function (event) {
                        const tr = event.target.transaction
                        const cursor = event.target.result

                        if (!cursor) {
                            tr.commit()
                            return
                        }
                        cursor.delete()
                        cursor.continue()
                    }
                    return
                }
                cursor.delete()
                cursor.continue()
            }
        })
    })
}