// ==UserScript==
// @name         NGA检查帖子可见状态
// @namespace    https://github.com/stone5265/GreasyFork-NGA-Check-Post-Status
// @version      0.4.2
// @author       stone5265
// @description  不可见楼层提醒 与 可见状态关注列表
// @license      MIT
// @require      https://lf9-cdn-tos.bytecdntp.com/cdn/expire-1-y/localforage/1.10.0/localforage.min.js#sha512=+BMamP0e7wn39JGL8nKAZ3yAQT2dL5oaXWr4ZYlTGkKOaoXM/Yj7c4oy50Ngz5yoUutAG17flueD4F6QpTlPng==
// @require      https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-y/jquery/3.4.0/jquery.min.js#sha512=Pa4Jto+LuCGBHy2/POQEbTh0reuoiEXQWXGn8S7aRlhcwpVkO8+4uoZVSOqUjdCsE+77oygfu2Tl+7qGHGIWsw==
// @match        *://bbs.nga.cn/*
// @match        *://ngabbs.com/*
// @match        *://nga.178.com/*
// @exclude      */nuke.php*
// @exclude      */misc/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @inject-into  content
// ==/UserScript==

(function () {
    const debounce = (fn, delay = 500) => {
        let id
        let pendingPromise
        let resolvePending

        return (...args) => {
            clearTimeout(id)

            if (pendingPromise) {
            resolvePending(new Error("Debounced call cancelled"))
            }

            pendingPromise = new Promise((resolve) => {
            resolvePending = resolve
            });

            id = setTimeout(async () => {
            try {
                const result = await fn(...args)
                resolvePending(result)
            } catch (err) {
                resolvePending(err)
            } finally {
                pendingPromise = null
            }
            }, delay)

            return pendingPromise
        };

    }
    'use strict';
    const CheckPostStatus = {
        name: 'CheckPostStatus',
        title: 'NGA检查帖子可见状态',
        desc: '检查自己发布的 主题/回复 别人是否能看见',
        settings: [
            {
                type: 'advanced',
                key: 'expireDays',
                title: '关注过期的天数',
                desc: '关注过期的天数，过期的关注在“检查全部”时不会进行检查\n（-1为永不过期）',
                default: 120,
                min: -1,
                menu: 'left'
            }, {
                type: 'advanced',
                key: 'autoDeleteAfterDays',
                title: '关注过期后自动删除的天数',
                desc: '关注过期的天数，过期的关注在“检查全部”时不会进行检查\n（-1为不进行自动删除）',
                default: 1,
                min: -1,
                menu: 'left'
            }, {
                type: 'advanced',
                key: 'isAutoCheck',
                title: '自动检查开关',
                desc: '当处于某个版面的第一页时触发自动检查判断',
                default: false,
                menu: 'right'
            }, {
                type: 'advanced',
                key: 'autoCheckInterval',
                title: '自动检查的间隔 (分钟)',
                desc: '自动检查关注列表的间隔，当处于某个版面的第一页时触发\n（最短间隔为5分钟，建议不少于30分钟）',
                default: 60,
                min: 5,
                menu: 'right'
            }
        ],
        store: null,
        cacheFid: {},
        lastWarningFid: -1,
        lastVisibleCheckUrl: '',
        lastMissingCheckUrl: '',
        visibleFloors: new Set(),
        lock: new Promise(() => {}),
        locks: new Array(20).fill(new Promise(() => {})),
        initFunc() {
            const $ = script.libs.$
            const this_ = this
            // 创建储存实例
            this.store = script.createStorageInstance('NGA_BBS_Script__CheckPostStatus')
            // 初始化的时候清除超过一定天数的过期关注
            const currentTime = Math.floor(Date.now() / 1000)   // 秒
            let removedCount = 0
            this.store.iterate((record, key) => {
                const isPermanent = record.expireTime === -1
                if (!isPermanent && currentTime >= record.expireTime) {
                    const expireDays = Math.floor((record.expireTime - currentTime) / 60 / 60 / 12)
                    const isAutoDelete = script.setting.advanced.autoDeleteAfterDays >= 0
                    if (isAutoDelete && expireDays >= script.setting.advanced.autoDeleteAfterDays) {
                        this_.store.removeItem(key)
                        removedCount += 1
                    }
                }
            })
            .then(() => {
                script.printLog(`${this.title}: 已清除${removedCount}条过期关注`)
            })
            .catch(err => {
                console.error(`${this.title}清除超期数据失败，错误原因:`, err)
            })

            // 点击"关注该楼层可见状态"按钮
            $('body').on('click', '.cps__watch_icon', function () {
                // 找到同一个容器内的另一个按钮
                const $container = $(this).parent()
                const $otherButton = $container.find('.cps__watch_icon').not($(this))
                // 切换显示状态
                $(this).hide()
                $otherButton.show()

                const type = $(this).data('type')
                const href = $(this).data('href')
                const floorNum = $(this).data('floor')

                const params = this_.getUrlParams(href)
                const key = `tid=${params['tid']}&pid=${params['pid']}`

                if (type === 'unwatch') {
                    // 添加关注
                    const isPermanent = script.setting.advanced.expireDays < 0
                    const expireTime = isPermanent ? -1 : Math.floor(Date.now() / 1000) + script.setting.advanced.expireDays * 24 * 60 * 60   // 秒
                    this_.store.setItem(key, {
                        topicName: document.title.replace(/\sNGA玩家社区/g, ''),
                        floorNum: parseInt(floorNum),
                        isVisible: null,
                        checkTime: null,
                        expireTime: expireTime
                    })
                    .then(() => {
                        this_.reloadWatchlist()
                    })
                } else {
                    // 取消关注
                    this_.store.removeItem(key)
                    .then(() => {
                        this_.reloadWatchlist()
                    })
                }
            })

            // 点击"重置时间"或者"永久关注"按钮
            $('body').on('click', '.cps__wl-change-expire-time', function() {
                const key = $(this).data('key')
                const time = $(this).data('time')
                const expireTime = time === -1 ? -1 : Math.floor(Date.now() / 1000) + script.setting.advanced.expireDays * 24 * 60 * 60   // 秒
                this_.store.getItem(key)
                .then(record => {
                    this_.store.setItem(key, {
                        ...record,
                        expireTime: expireTime
                    })
                    .then(() => {
                        this_.reloadWatchlist()
                    })
                })
            })

            // 点击"检查"按钮
            $('body').on('click', '.cps__wl-check', function() {
                const key = $(this).data('key')
                this_.checkRowVisible(key)
                .then(isVisible => {
                    script.popMsg(`检查完成，目标位于${isVisible ? '可见' : '不可见'}状态`)
                    this_.reloadWatchlist()
                })
            })

            // 点击"删除"按钮
            $('body').on('click', '.cps__wl-del', function() {
                const key = $(this).data('key')
                this_.store.removeItem(key)
                .then(() => {
                    this_.reloadWatchlist()
                })
            })

            // 点击"刷新"按钮
            $('body').on('click', '.cps__panel-refresh', function() {
                this_.reloadWatchlist()
            })

            // 点击"检查全部"按钮
            $('body').on('click', '.cps__panel-checkall', async function() {
                const $button = $(this)
                $button.text('检查中...').prop('disabled', true)

                try {
                    const rows = await this_.getSurvivalRows()

                    let invisibleNum = 0
                    let processed = 0

                    for (const key of rows) {
                        const isVisible = await this_.checkRowVisible(key)
                        if (!isVisible) {
                            invisibleNum++
                        }

                        processed++
                        this_.reloadWatchlist()
                        $button.text(`检查中... (${processed}/${rows.length})`)

                        if (processed < rows.length) {
                            // 设置检查间隔
                            await new Promise(resolve => setTimeout(resolve, 1000))
                        }
                    }

                    if (rows.length !== 0) {
                        script.popMsg(`检查完成，总共检查了${rows.length}个楼层，其中${invisibleNum}个位于不可见状态`)
                    }
                } catch (err) {
                    script.popMsg(`失败！${err.message}`)
                } finally {
                    $button.text('检查所有').prop('disabled', false)
                }
            })

            // 点击"清除过期关注"按钮
            $('body').on('click', '.cps__panel-clean-expired', async function() {
                this_.cleanExpiredData()
                .then(() => {
                    this_.reloadWatchlist()
                })
            })

            // 点击"清空*所有*关注"按钮
            $('body').on('click', '.cps__panel-clean-all', function() {
                this_.cleanLocalData()
                .then(() => {
                    this_.reloadWatchlist()
                })
            })
            
            // 切换选项卡
            $('body').on('click', '.cps__tab-header > span', function(){
                $('.cps__tab-header > span, .cps__tab-content').removeClass('cps__tab-active')
                $(this).addClass('cps__tab-active')
                $('.cps__tab-content').eq($(this).index()).addClass('cps__tab-active')
                this_.reloadWatchlist()
            })

            // 关闭"关注列表"
            $('body').on('click', '.cps__list-panel .cps__panel-close', function () {
                if ($(this).attr('close-type') == 'hide') {
                    $(this).parent().hide()
                } else {
                    $(this).parent().remove()
                }
            })
            
            // 点击"设置面板"按钮
            $('body').on('click', '.cps__panel-settings', function() {
                $('#hld_cps_setting_cover').css('display', 'block').css('position', 'fixed')
                $('#hld_cps_setting_panel').css('display', 'block')
            })

            // 关注列表
            GM_registerMenuCommand('关注列表', function () {
                if($('#cps__watchlist_panel').length > 0) return
                
                $('body').append(`
                    <div id="cps__watchlist_panel"  class="cps__list-panel animated fadeInUp">
                        <a href="javascript:void(0)" class="cps__panel-close">×</a>
                        <div>
                            <button class="cps__panel-settings">设置面板</button>
                            <span id="cps__auto_check_info">
                            </span>
                        </div>
                        
                        <hr>

                        <div class="cps__tab-header"><span class="cps__tab-active">关注列表（全部）</span><span>关注列表（不可见）</span></div>

                        <div class="cps__tab-content cps__tab-active">
                            <div class="cps__list-c">
                                <button class="cps__panel-refresh hld_cps_help" help="手动刷新列表的时间显示">刷新</button>
                                <button class="cps__panel-checkall">检查所有</button>
                                <button class="cps__panel-clean-expired hld_cps_help" help="过期超过一定时间(*设置面板*中可设置)会自动删除">清除过期关注</button>
                                <button class="cps__panel-clean-all">清空*所有*关注</button>
                                <div class="cps__scroll-area">
                                    <table class="cps__table">
                                        <thead>
                                            <tr>
                                                <th style="text-align:left;">主题</th>
                                                <th width=90px>楼层</th>
                                                <th width=50px>状态</th>
                                                <th width=75px>上次检查</th>
                                                <th width=75px>剩余时间</th>
                                                <th width=220px>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody id="cps__watchlist"></tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="cps__tab-content">
                            <div class="cps__list-c">
                                <button class="cps__panel-refresh hld_cps_help" help="手动刷新列表的时间显示">刷新</button>
                                <button disabled class="cps__panel-checkall" style="opacity: 0.6; cursor: not-allowed;">检查所有</button>
                                <button class="cps__panel-clean-expired hld_cps_help" help="过期超过一定时间(*设置面板*中可设置)会自动删除">清除过期关注</button>
                                <button disabled class="cps__panel-clean-all" style="opacity: 0.6; cursor: not-allowed;">清空*所有*关注</button>

                                <div class="cps__scroll-area">
                                    <table class="cps__table">
                                        <thead>
                                            <tr>
                                                <th style="text-align:left;">主题</th>
                                                <th width=90px>楼层</th>
                                                <th width=50px>状态</th>
                                                <th width=75px>上次检查</th>
                                                <th width=75px>剩余时间</th>
                                                <th width=220px>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody id="cps__watchlist-invisible"></tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                `)

                this_.reloadAutoCheckInfo()
                this_.reloadWatchlist()
            })
        },
        // 位于帖子列表页时自动检查关注列表
        async renderThreadsFunc($el) {
            // 未勾选自动检查开关时, 不进行自动检查
            if (!script.setting.advanced.isAutoCheck) return
            // 位于列表页第一页的第一个帖子时才触发自动检查
            if ($el.find('a').attr('id') !== 't_rc1_0') return

            const $ = script.libs.$
            const lastAutoCheckTime = await GM_getValue('cps__lastAutoCheckTime')
            const currentTime = Math.floor(Date.now() / 1000 / 60)   // 分钟
            const deltaTime = currentTime - parseFloat(lastAutoCheckTime)
            const autoCheckInterval = script.setting.advanced.autoCheckInterval
            // 距离上次自动检查小于设置的间隔时, 不进行自动检查
            if (lastAutoCheckTime && deltaTime < autoCheckInterval) return

            try {
                const rows = await this.getSurvivalRows()
                // 关注列表为空时, 不进行自动检查
                if (rows.length === 0) return

                script.popMsg(`[自动检查]开始...预计检查${rows.length}个关注`)

                let invisibleNum = 0
                let processed = 0

                for (const key of rows) {
                    const isVisible = await this.checkRowVisible(key)
                    if (!isVisible) {
                        invisibleNum++
                    }

                    processed++
                    this.reloadWatchlist()
                    const $button = $(document).find('.cps__panel-checkall')
                    if ($button.length) {
                        $button.text(`检查中... (${processed}/${rows.length})`).prop('disabled', true)
                    }

                    if (processed < rows.length) {
                        await new Promise(resolve => setTimeout(resolve, 1500))
                    }
                }

                script.popMsg(`[自动检查]总共检查了${rows.length}个关注，其中${invisibleNum}个位于不可见状态`)
                // 更新最后一次自动检查时间
                GM_setValue('cps__lastAutoCheckTime', String(currentTime))
            } catch (err) {
                script.popMsg(`[自动检查]失败！${err.message}`)
                // 更新最后一次自动检查时间
                GM_setValue('cps__lastAutoCheckTime', String(currentTime))
            } finally {
                const $button = $(document).find('.cps__panel-checkall')
                if ($button.length) {
                    $button.text('检查所有').prop('disabled', false)
                }
                this.reloadAutoCheckInfo()
            }
        },
        async renderFormsFunc($el) {
            const $ = script.libs.$
            const this_ = this
            // 去除 #后的内容 比如 (/read.php?tid=xxx&page=1#pidxxxxAnchor 去掉#pidxxxxAnchor)
            const checkUrl = document.baseURI.split('#')[0]

            // 检查检查详细页缺失的楼层 (目前账号无法看到的楼层)
            this.checkMissingFloors(checkUrl)

            /**
             * "tid={}(&authorid={})(&page={})"
             */
            const queryString = checkUrl.split('?')[1]
            /**
             * "pid{}Anchor"
             */
            const pidAnchor = $el.find('td.c2').find('a')[0].id
            /**
             * "l{}"
             */
            const floorName = $el.find('td.c2').find('a')[1].name
            const currentFloor = parseInt(floorName.slice(1))

            /**
             * "/read.php?tid={}(&authorid={})&page={}#pid{}Anchor"
             */
            const href = `/read.php?${queryString}${queryString.includes('&page=') ? '' : '&page=1'}#${pidAnchor}`
            const params = this.getUrlParams(href)

            // 检查该版面是否需要登录才能查看
            const isLimit = await this.checkFidLimit(__CURRENT_FID)

            // 若该版面需要登录才能访问, 则不支持部分功能
            if (isLimit) {
                // 当前版面只提示一次
                if (__CURRENT_FID !== this.lastWarningFid) {
                    this.lastWarningFid = __CURRENT_FID
                    script.popMsg('该版面需要登陆才能访问，不支持[关注按钮]', 'warn')
                }
            }

            // 添加"关注该楼层可见状态"按钮
            if (!isLimit) {
                const key = `tid=${params['tid']}&pid=${params['pid']}`
                const watching = await this.store.getItem(key) !== null

                $el.find('.small_colored_text_btn.block_txt_c2.stxt').each(function () {
                    const mbDom = `
                        <a class="cps__watch_icon hld_cps_help"
                            help="关注该楼层可见状态"
                            data-type="unwatch"
                            data-href="${href}"
                            data-floor="${currentFloor}"
                            style="${!watching ? '' : 'display: none;'}">⚪</a>
                        <a class="cps__watch_icon hld_cps_help"
                            help="取消关注该楼层可见状态"
                            data-type="watch"
                            data-href="${href}"
                            data-floor="${currentFloor}"
                            style="${watching ? '' : 'display: none;'}">🔵</a>
                    `
                    $(this).append(mbDom)
                })
            }

            // 检查该页面下登录用户的发言
            const uid = parseInt($el.find('a[name="uid"]').text())
            if (!isNaN(__CURRENT_UID) && uid === __CURRENT_UID) {
                if (!isLimit) {
                    // (正常区) 使用游客状态对当前页可见楼层进行标记
                    if (checkUrl !== this.lastVisibleCheckUrl) {
                        this.lastVisibleCheckUrl = checkUrl
                        // 记录当前页游客可见楼层号
                        this.visibleFloors = new Set()
                        const execute = debounce(async () => {
                            const result = this_.requestWithoutAuth(checkUrl)
                            .then(({ success, $html }) => {
                                if (success) {
                                    // 记录当前页面所有游客能看到的楼层号
                                    for (const floor of $html.find('td.c2')) {
                                        const visibleFloor = parseInt($(floor).find('a')[1].name.slice(1))
                                        this_.visibleFloors.add(visibleFloor)
                                    }
                                }
                            })
                            return result
                        }, 1500)
                        this.lock = execute()
                    }
                    await this.lock
                } else {
                    // (需要登录才能进的区) 单独向每个属于登录用户的楼层发送一条编辑请求
                    if (checkUrl !== this.lastVisibleCheckUrl) {
                        this.lastVisibleCheckUrl = checkUrl
                        this.visibleFloors = new Set()
                        this.locks = Array(20).fill().map(() => {
                            let resolveFn
                            const promise = new Promise(resolve => resolveFn = resolve)
                            return { promise, resolveFn }
                        })

                        const floors = Object.keys(commonui.postArg.data)
                        for (let floor of floors) {
                            if (isNaN(floor)) continue
                            floor = parseInt(floor)
                            // 如果处理完已经切换到其他页面, 则放弃对该页的后续操作
                            if (!(floor in commonui.postArg.data)) {
                                this.locks.forEach(lock => lock.resolveFn())
                                return
                            }
                            const data = commonui.postArg.data[floor]
                            if (parseInt(data.pAid, 10) !== __CURRENT_UID) continue

                            const { success } = await new Promise((resolve) => {
                                fetch(`/post.php?lite=js&action=modify&tid=${data.tid}&pid=${data.pid}`)
                                .then((res) => res.blob())
                                .then((blob) => {
                                    const reader = new FileReader()

                                    reader.onload = () => {
                                        const text = reader.result;
                                        const result = JSON.parse(
                                            text.replace("window.script_muti_get_var_store=", "")
                                        )

                                        const { data, error } = result

                                        if (error) {
                                            resolve({ success: false })
                                            return
                                        }

                                        if (data && data['post_type'] & 2) {
                                            // resolve('只有作者/版主可见')
                                            resolve({ success: false })
                                            return
                                        }

                                        fetch(`/post.php?lite=js&tid=${data.tid}&pid=${data.pid}`)

                                        resolve({ success: true })
                                    }

                                    reader.readAsText(blob, "GBK")
                                })
                                .catch(() => {
                                    // resolve("")
                                    resolve({ success: false })
                                })
                            })
                            if (success) {
                                this.visibleFloors.add(floor)
                            }
                            this.locks[floor % 20].resolveFn()
                            await new Promise(resolve => setTimeout(resolve, 500))
                        }
                    }
                    
                    await this.locks[currentFloor % 20].promise
                }

                const isVisible = this.visibleFloors.has(currentFloor)
                
                // 如果楼层切换的比较快，等这页的游客访问完早已切换到另一页，则放弃对该楼的后续操作
                if ($(document).find($el).length === 0) {
                    // console.log(`抛弃${floorName}`)
                    return
                }

                // 对不可见的楼层添加标记并提示
                let mbDom
                if (!isVisible) {
                    const floorName = currentFloor === 0 ? '主楼' : `${currentFloor}楼`
                    mbDom = '<span class="visibility_text hld_cps_help" help="若该状态持续超过30分钟，请联系版务协助处理" style="color: red; font-weight: bold;"> [不可见] </span>'
                    script.popNotification(`当前页检测到${floorName}其他人不可见`, 4000)
                } else {
                    mbDom = '<span class="visibility_text" style="font-weight: bold;"> 可见 </span>'
                }
                $el.find('.small_colored_text_btn.block_txt_c2.stxt').each(function () {
                    $(this).append(mbDom)
                })
            }
        },
        /**
         * 游客状态访问
         * @method requestWithoutAuth
         * @param {string} url 
         */
        requestWithoutAuth(url) {
            const $ = script.libs.$
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    anonymous: true,    // enforces 'fetch' mode
                    responseType: 'arraybuffer',    // fetch模式下该设置无效
                    onload: function(response) {
                        const text = response.response instanceof ArrayBuffer ? new TextDecoder('gbk').decode(response.response) : response.response

                        if (response.status === 200) {
                            resolve({
                                success: true,
                                $html: $(text)
                            })
                        }

                        // 获取错误信息
                        const errorCode = text.match(/(ERROR:<!--msgcodestart-->([\d]+)<!--msgcodeend-->)/)[2]
                        const errorMessage = `(ERROR:${errorCode})`
                        // let errorCode
                        // let errorMessage
                        // if (response.response instanceof ArrayBuffer) {
                        //     errorCode = text.match(/(ERROR:<!--msgcodestart-->([\d]+)<!--msgcodeend-->)/)[2]
                        //     errorMessage = text.match(/<title>([^<]+)<\/title>/)[1]
                        // } else {
                        //     errorCode = text.match(/(ERROR:<!--msgcodestart-->([\d]+)<!--msgcodeend-->)/)[2]
                        //     errorMessage = `(ERROR:${errorCode})`
                        // }

                        // "(ERROR:15)访客不能直接访问" 进行跳转后可访问
                        if (errorCode === '15') {
                            // 跳转所需要用到的游客cookie
                            const lastvisit = response.responseHeaders.match(/lastvisit=([^;]+)/)[0]
                            const ngaPassportUid = response.responseHeaders.match(/ngaPassportUid=([^;]+)/)[0]
                            const guestJs = text.match(/guestJs=([^;]+)/)[0]

                            // 添加随机参数防止缓存
                            const r = Math.floor(Math.random()*1000)
                            const finalUrl = response.finalUrl.replace(/(?:\?|&)rand=\d+/,'')+'&rand=' + r

                            // 携带游客cookie后再次访问
                            GM_xmlhttpRequest({
                                method: 'GET',
                                url: finalUrl,
                                headers: {
                                  "Cookie": `${lastvisit}; lastpath=0; ${ngaPassportUid}; ${guestJs}`,
                                  'Referer': response.finalUrl
                                },
                                anonymous: true,
                                onload: function(response) {
                                    if (response.status === 200) {
                                        resolve({
                                            success: true,
                                            $html: $(response.responseText)
                                        })
                                    } else {
                                        const errorCode = text.match(/(ERROR:<!--msgcodestart-->([\d]+)<!--msgcodeend-->)/)[2]
                                        console.error(`(ERROR:${errorCode})`)
                                        resolve({ success: false })
                                    }
                                },
                                onerror: function(error) {
                                    console.error(error)
                                    resolve({ success: false })
                                }
                            })
                        } else {
                            console.error(errorMessage)
                            resolve({ success: false })
                        }
                        
                    },
                    onerror: function(error) {
                        console.error(error)
                        resolve({ success: false })
                    }
                })
            })
        },
        /**
         * 检查该页面缺失的楼层 (目前账号无法看到的楼层)
         * @method checkMissingFloors
         * @param {string} checkUrl 
         */
        checkMissingFloors(checkUrl) {
            const $ = script.libs.$
            if ((checkUrl === this.lastMissingCheckUrl)) return
            this.lastMissingCheckUrl = checkUrl
            // 倒序模式
            const isReversed = commonui.postArg.def.tmBit1 & 262144
            // 只看作者模式
            const isOnlyAuthor = checkUrl.match(/authorid=/) !== null
            // 该贴总回帖数
            const maxFloor = commonui.postArg.def.tReplies
            // 获取当前所在页的页数 (注: 使用  __PAGE[2] 获取的当前页数 在点击"加载下一页"按钮时 获取的还是当前页而非新加载出来的一页的页数)
            const pageMatch = checkUrl.match(/page=([\d]+)/)
            let currentPage = pageMatch ? parseInt(pageMatch[1]) : 1
            // 正序模式回帖或者编辑, 前者page=e, 后者不会出现page=
            if (!pageMatch && __PAGE !== undefined) {
                currentPage = __PAGE[2]
            }
            // 是否为最后一页
            const isLastPage = pageMatch ? currentPage === __PAGE[1] : true
            // 该页开始楼层号
            let startFloor
            // 该页截止楼层号
            let endFloor
            // 记录当前页目前账号能看到的楼层
            const currPageFloors = new Set()
            $(document).find('.forumbox .postrow').each((index, dom) => {
                const floor = parseInt($(dom).attr('id').split('strow')[1])
                currPageFloors.add(floor)
            })
            
            if (isOnlyAuthor) {
                // 不支持倒序模式下的只看作者
                if (isReversed) {
                    script.popMsg('[检查缺失楼层]不支持倒序模式下的只看作者', 'warn')
                    return
                }
                // 只看作者模式的最后一页只能使用该页能看到的楼层中最大楼层号
                if (isLastPage) {
                    startFloor = Math.max(1, (currentPage - 1) * 20)
                    endFloor = Math.max(...currPageFloors)
                }
            }
            else {
                if (!isReversed) {
                    // 正序模式通过该页页数来计算范围 (并对其进行阻断来保证最后一页范围计算正确)
                    startFloor = Math.max(1, (currentPage - 1) * 20)
                    endFloor = Math.min(maxFloor, currentPage * 20 - 1)
                } else {
                    // 倒序模式通过模拟来计算当前页楼层号的范围
                    // 第一页跳过主楼
                    let iPage = 1
                    endFloor = maxFloor
                    startFloor = endFloor - 18
                    // 第二页到当前页
                    ++iPage
                    while (iPage <= currentPage) {
                        endFloor -= 20
                        startFloor -= 20
                        ++iPage
                    }
                    // 截断最后一页的开始楼号
                    startFloor = Math.max(1, startFloor)
                }
            }

            // 主楼检查 (用于只看作者模式)
            if (currentPage === 1 && !currPageFloors.has(0)) {
                script.popNotification(`当前页检测到0楼缺失`, 4000)
            }

            let count = 0
            if (!isReversed) {
                // 正序提示
                for (let i = Math.max(1, startFloor); i <= Math.min(maxFloor, endFloor); ++i) {
                    // 一页最多存在20个楼层, 超出则说明代码有BUG, 终止提示防止不必要的开销
                    if (++count > 20) {
                        break
                    }

                    if (!currPageFloors.has(i)) {
                        script.popNotification(`当前页检测到${i}楼缺失`, 4000)
                    }
                }
            } else {
                // 倒序提示
                for (let i = Math.min(maxFloor, endFloor); i >= Math.max(1, startFloor); --i) {
                    // 一页最多存在20个楼层, 超出则说明代码有BUG, 终止提示防止不必要的开销
                    if (++count > 20) {
                        break
                    }

                    if (!currPageFloors.has(i)) {
                        script.popNotification(`当前页检测到${i}楼缺失`, 4000)
                    }
                }
            }
        },
        /**
         * 检查该版面是否需要登录才能查看
         * @method checkFidLimit
         * @param {number} fid 
         */
        async checkFidLimit(fid) {
            // 对版面限制进行缓存
            if (this.cacheFid[fid] === undefined) {
                this.cacheFid[fid] = new Promise((resolve) => {
                    fetch(`/thread.php?fid=${fid}&lite=js`, {
                        method: 'GET',
                        credentials: 'omit'
                    })
                    .then((res) => res.blob())
                    .then((blob) => {
                        const reader = new FileReader()

                        reader.onload = () => {
                            const text = reader.result
                            const result = JSON.parse(
                                text.replace("window.script_muti_get_var_store=", "")
                            )

                            const { data, error } = result

                            if (error) {
                                resolve(error[0])
                            } else {
                                resolve('')
                            }
                        }

                        reader.readAsText(blob, "GBK")
                    })
                    .catch((err) => {
                        resolve(err.message)
                    })
                })
            }

            const error = await this.cacheFid[fid]
            return error === '1:未登录'
        },
        /**
         * 获取URL参数对象
         * @method getUrlParams
         * @param {string} url"/read.php?tid={}(&authorid={})&page={}#pid{}Anchor"
         * @return {Object} 参数对象
         */
        getUrlParams(url) {
            let params = {}
            const $ = url.split('#')
            const url_ = $[0]
            const pid = parseInt($[1].slice(3, -6))
            const queryString = url_.split('?')[1]
            queryString.split('&').forEach(item => {
                const $ = item.split('=')
                if ($[0] && $[1]) {
                    params[$[0]] = parseInt($[1])
                }
            })
            params['pid'] = pid
            return params
        },
        /**
         * 重新渲染自动检查信息
         * @method reloadWatchlist
         */
        async reloadAutoCheckInfo() {
            const $ = script.libs.$
            if($('#cps__watchlist_panel').length === 0) return
            const $autoCheckInfo = $('#cps__auto_check_info')
            
            const isAutoCheck = script.setting.advanced.isAutoCheck
            const interval = `${script.setting.advanced.autoCheckInterval}分钟`
            const lastAutoCheckTime = await GM_getValue('cps__lastAutoCheckTime')
            let lastCheck
            if (lastAutoCheckTime) {
                const timestamp = new Date(parseInt(lastAutoCheckTime) * 60 * 1000)
                lastCheck = timestamp.toLocaleString().slice(0, -3)
            } else {
                lastCheck = '-'
            }
            $autoCheckInfo.empty()
            $autoCheckInfo.append(`自动检查: ${isAutoCheck ? `<span style="color: green;">on</span> | 检查间隔: ${interval} | 上次自动检查时间: ${lastCheck}` : '<span style="color: grey;">off</span>'}`)
        },
        /**
         * 重新渲染关注列表
         * @method reloadWatchlist
         */
        reloadWatchlist() {
            const $ = script.libs.$
            if($('#cps__watchlist_panel').length === 0) return
            let $watchlist
            let isWatchlistInbisible
            const $watchlistAll = $('.cps__tab-active #cps__watchlist')
            const $watchlistInbisible = $('.cps__tab-active #cps__watchlist-invisible')
            if ($watchlistAll.length === 0 && $watchlistInbisible.length === 0) {
                return
            } else {
                if ($watchlistAll.length) {
                    $watchlist = $watchlistAll
                    isWatchlistInbisible = false
                } else {
                    $watchlist = $watchlistInbisible
                    isWatchlistInbisible = true
                }
            }

            let expiredRows = []
            let rows = []

            this.store.iterate((record, key) => {
                if (isWatchlistInbisible && record.isVisible !== false) return

                const currentTime = Math.floor(Date.now() / 1000)   // 秒
                const isPermanent = record.expireTime === -1
                const isSurvival = isPermanent || currentTime < record.expireTime
                let timeLeft
                if (isSurvival) {
                    if (isPermanent) {
                        timeLeft = '永久'
                    } else {
                        timeLeft = Math.floor((record.expireTime - currentTime) / 60 / 60)
                        if (timeLeft === 0) {
                            timeLeft = '<1小时'
                        } else if (timeLeft < 24) {
                            timeLeft = `${timeLeft}小时`
                        } else {
                            timeLeft = `${Math.floor(timeLeft / 24)}天`
                        }
                    }
                } else {
                    timeLeft = Math.floor((currentTime - record.expireTime) / 60 / 60)
                    if (timeLeft === 0) {
                        timeLeft = '已过期（<1小时）'
                    } else if (timeLeft < 24) {
                        timeLeft = `已过期（${timeLeft}小时）`
                    } else {
                        timeLeft = `已过期（${Math.floor(timeLeft / 24)}天）`
                    }
                }
                let timeSinceLastCheck
                let visibleStatus
                if (record.checkTime !== null) {
                    timeSinceLastCheck = Math.floor((currentTime - record.checkTime) / 60)
                    if (timeSinceLastCheck === 0) {
                        timeSinceLastCheck = '<1分钟'
                    } else if (timeSinceLastCheck < 60 * 3) {
                        timeSinceLastCheck = `${timeSinceLastCheck}分钟前`
                    } else if (timeSinceLastCheck < 60 * 24) {
                        timeSinceLastCheck = `${Math.floor(timeLeft / 60)}小时前`
                    } else {
                        timeSinceLastCheck = '超过1天'
                    }
                    visibleStatus = record.isVisible ? '可见' : '<span style="color: red; font-weight: bold;">不可见</span>'
                } else {
                    timeSinceLastCheck = '-'
                    visibleStatus = '-'
                }
                const floor = record.floorNum === 0 ? '主楼' : `${record.floorNum}楼`
                const keywords = key.split('&')   // key='tid={}&pid={}'
                const query = keywords[1] === 'pid=0' ? keywords[0] : keywords[1]
                // 对应楼层跳转链接
                const href = `/read.php?${query}&opt=128`
                const context = `
                <tr>
                    <td style="text-align:left;" title="${record.topicName}">${record.topicName}</td>
                    <td title="${href}"><a href="${href}" class="urlincontent">${floor}</a></td>
                    <td>${visibleStatus}</td>
                    <td title="${timeSinceLastCheck}">${timeSinceLastCheck}</td>
                    <td title="${timeLeft}">${timeLeft}</td>
                    <td>
                        <button class="cps__wl-change-expire-time hld_cps_help" help="重置剩余时间为设置的关注过期天数" data-key="${key}" data-time="reset" >重置</span>
                        <button class="cps__wl-change-expire-time hld_cps_help" help="将剩余时间设置为永不过期" data-key="${key}" data-time=-1 help="将剩余时间设置为永不过期">永久</span>
                        <button class="cps__wl-check" data-key="${key}">检查</span>
                        <button class="cps__wl-del" data-key="${key}">删除</span>
                    </td>
                </tr>
                `
                if (isSurvival) {
                    rows.push([key, context])
                } else {
                    expiredRows.push([key, context])
                }
            })
            .then(() => {
                $watchlist.empty()
                // 按照tid进行排序
                expiredRows.sort((a, b) => a[0].localeCompare(b[0]))
                rows.sort((a, b) => a[0].localeCompare(b[0]))
                // 将过期关注放在最上面
                expiredRows.forEach(row => $watchlist.append(row[1]))
                rows.forEach((row) => $watchlist.append(row[1]))
            })
        },
        /**
         * 获取关注列表中所有未失效的行
         * @method getSurvivalRows
         */
        async getSurvivalRows() {
            const currentTime = Math.floor(Date.now() / 1000)   // 秒
            const rows = []
            await this.store.iterate((record, key) => {
                const isPermanent = record.expireTime === -1
                const isSurvival = isPermanent || currentTime < record.expireTime
                if (isSurvival) {
                    rows.push(key)
                }
            })
            return rows
        },
        /**
         * 检查关注列表中某一行的可见状态
         * @method checkRowVisible
         */
        async checkRowVisible(key) {
            const keywords = key.split('&')   // key='tid={}&pid={}'
            const query = keywords[1] === 'pid=0' ? keywords[0] : keywords[1]
            const href = `/read.php?${query}`

            const { success, $html } = await this.requestWithoutAuth(href)
            const isVisible = success && $html.find('table.forumbox.postbox').length > 0

            const record = await this.store.getItem(key)
            await this.store.setItem(key, {
                ...record,
                isVisible: isVisible,
                checkTime: Math.floor(Date.now() / 1000)   // 秒
            })

            return isVisible
        },
        /**
         * 清除过期关注
         * @method cleanLocalData
         */
        async cleanExpiredData() {
            this.store.iterate((record, key) => {
                const currentTime = Math.floor(Date.now() / 1000)   // 秒
                const isPermanent = record.expireTime === -1
                const isSurvival = isPermanent || currentTime < record.expireTime
                if (!isSurvival) {
                    this.store.removeItem(key)
                }
            })
        },
        /**
         * 清空关注列表
         * @method cleanLocalData
         */
        async cleanLocalData() {
            if (window.confirm('确定要清理所有关注吗？')) {
                await this.store.clear()
                alert('操作成功')
            }
        },
        style: `
        #cps__watchlist_panel .urlincontent:before {
            content: "[";
            vertical-align: 0.05em;
            padding: 0 0.15em;
            color: #bdb5ab;
        }
        #cps__watchlist_panel .urlincontent:after {
            content: "]";
            vertical-align: 0.05em;
            padding: 0 0.15em;
            color: #bdb5ab;
        }

        .cps__watch_icon {position: relative;padding:0 1px;text-decoration:none;cursor:pointer;}
        .cps__watch_icon {text-decoration:none !important;}

        .cps__tab-header {height:40px}
        .cps__tab-header>span {margin-right:10px;padding:5px;cursor:pointer}
        .cps__tab-header .cps__tab-active,.cps__tab-header>span:hover {color:#591804;font-weight:700;border-bottom:3px solid #591804}
        .cps__tab-content {display:flex;justify-content:space-between;flex-wrap: wrap;}
        .cps__tab-content {display:none}
        .cps__tab-content.cps__tab-active {display:flex}

        .cps__list-panel {position:fixed;top:50px;left:50%;transform:translate(-50%, -50%);width:80%;overflow:auto;max-height:60%;background:#fff8e7;padding:15px 20px;border-radius:10px;box-shadow:0 0 10px #666;border:1px solid #591804;z-index:888;}
        .cps__list-panel .cps__list-c {width:100%;height:100%}
        .cps__list-panel .cps__list-c textarea {box-sizing:border-box;padding:0;margin:0;height:100%;width:100%;resize:none;}
        .cps__list-panel .cps__list-c > p:first-child {font-weight:bold;font-size:14px;margin-bottom:10px;}

        #cps__watchlist_panel p {margin-bottom:10px;}

        .cps__panel-close {position:absolute;top:5px;right:5px;padding:3px 6px;background:#fff0cd;color:#591804;transition:all .2s ease;cursor:pointer;border-radius:4px;text-decoration:none;z-index:888;}
        .cps__panel-close:hover {background:#591804;color:#fff0cd;text-decoration:none;}

        .cps__table {table-layout:fixed;width:100%;height:100%;border-top:1px solid #ead5bc;border-left:1px solid #ead5bc}
        .cps__table thead {background:#591804;border:1px solid #591804;color:#fff}
        .cps__table td,.cps__table th {padding:3px 5px;border-bottom:1px solid #ead5bc;border-right:1px solid #ead5bc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}

        .cps__scroll-area {position:relative;height:100%;overflow:auto;border:1px solid #ead5bc}
        .cps__scroll-area::-webkit-scrollbar {width:6px;height:6px}
        .cps__scroll-area::-webkit-scrollbar-thumb {border-radius:10px;box-shadow:inset 0 0 5px rgba(0,0,0,.2);background:#591804}
        .cps__scroll-area::-webkit-scrollbar-track {box-shadow:inset 0 0 5px rgba(0,0,0,.2);border-radius:10px;background:#ededed}
        `
    }

    ////////////////////////////////////////////////////////////////

    class NGABBSScript_CheckPostStatus {
        constructor() {
            // 配置
            this.setting = {
                original: [],
                normal: {},
                advanced: {}
            }
            // 模块
            this.modules = []
            // 样式
            this.style = ''
            // 数据存储
            this.store = {}
            // 引用库
            this.libs = {$, localforage}
        }
        /**
         * 获取模块对象
         * @method getModule
         * @param {String} name 模块name
         * @return {Object} 模块对象
         */
        getModule(name) {
            for (const m of this.modules) {
                if (m.name && m.name === name) {
                    return m
                }
            }
            return null
        }
        // /**
        //  * 全程渲染函数
        //  * @method renderAlways
        //  */
        // renderAlways() {
        //     for (const module of this.modules) {
        //         try {
        //             module.renderAlwaysFunc && module.renderAlwaysFunc(this)
        //         } catch (error) {
        //             this.printLog(`[${module.name}]模块在[renderAlwaysFunc()]中运行失败！`)
        //             console.log(error)
        //         }
        //     }
        // }
        /**
         * 列表页渲染函数
         * @method renderThreads
         */
        renderThreads() {
            $('.topicrow[hld-cps-threads-render!=ok]').each((index, dom) => {
                const $el = $(dom)
                for (const module of this.modules) {
                    try {
                        module.renderThreadsFunc && module.renderThreadsFunc($el, this)
                    } catch (error) {
                        this.printLog(`[${module.name}]模块在[renderThreadsFunc()]中运行失败！`)
                        console.log(error)
                    }
                }
                $el.attr('hld-cps-threads-render', 'ok')
            })
        }
        /**
         * 详情页渲染函数
         * @method renderForms
         */
        renderForms() {
            $('.forumbox.postbox[hld-cps-forms-render!=ok]').each((index, dom) => {
                const $el = $(dom)
                // 等待NGA页面渲染完成
                if ($el.find('.small_colored_text_btn').length == 0) return true
                for (const module of this.modules) {
                    try {
                        module.renderFormsFunc && module.renderFormsFunc($el, this)
                    } catch (error) {
                        this.printLog(`[${module.name}]模块在[renderFormsFunc()]中运行失败！`)
                        console.log(error)
                    }
                }
                $el.attr('hld-cps-forms-render', 'ok')
            })
        }
        /**
         * 添加模块
         * @method addModule
         * @param {Object} module 模块对象
         * @param {Boolean} plugin 是否为插件
         */
        addModule(module) {
            // 组件预处理函数
            if (module.preProcFunc) {
                try {
                    module.preProcFunc(this)
                } catch (error) {
                    this.printLog(`[${module.name}]模块在[preProcFunc()]中运行失败！`)
                    console.log(error)
                }
            }
            // 添加设置
            const addSetting = setting => {
                // 标准模块配置
                if (setting.shortCutCode && this.setting.normal.shortcutKeys) {
                    this.setting.normal.shortcutKeys.push(setting.shortCutCode)
                }
                if (setting.key) {
                    this.setting[setting.type || 'normal'][setting.key] = setting.default ?? ''
                    this.setting.original.push(setting)
                }
            }
            // 功能板块
            if (module.setting && !Array.isArray(module.setting)) {
                addSetting(module.setting)
            }
            if (module.settings && Array.isArray(module.settings)) {
                for (const setting of module.settings) {
                    addSetting(setting)
                }
            }
            // 添加样式
            if (module.style) {
                this.style += module.style
            }
            this.modules.push(module)
        }
        /**
         * 判断当前页面是否为列表页
         * @method isThreads
         * @return {Boolean} 判断状态
         */
        isThreads() {
            return $('#m_threads').length > 0
        }
        /**
         * 判断当前页面是否为详情页
         * @method isForms
         * @return {Boolean} 判断状态
         */
        isForms() {
            return $('#m_posts').length > 0
        }
        /**
         * 抛出异常
         * @method throwError
         * @param {String} msg 异常信息
         */
        throwError(msg) {
            alert(msg)
            throw(msg)
        }
        /**
         * 初始化
         * @method init
         */
        init() {
            // 开始初始化
            this.printLog('初始化...')
            localforage.config({name: 'NGA BBS Script DB'})
            const startInitTime = new Date().getTime()
            const modulesTable = []
            //同步配置
            this.loadSetting()
            // 组件初始化函数
            for (const module of this.modules) {
                if (module.initFunc) {
                    try {
                        module.initFunc(this)
                    } catch (error) {
                        this.printLog(`[${module.name}]模块在[initFunc()]中运行失败！`)
                        console.log(error)
                    }
                }
            }
            // 组件后处理函数
            for (const module of this.modules) {
                if (module.postProcFunc) {
                    try {
                        module.postProcFunc(this)
                    } catch (error) {
                        this.printLog(`[${module.name}]模块在[postProcFunc()]中运行失败！`)
                        console.log(error)
                    }
                }
            }
            // 动态样式
            for (const module of this.modules) {
                if (module.asyncStyle) {
                    try {
                        this.style += module.asyncStyle(this)
                    } catch (error) {
                        this.printLog(`[${module.name}]模块在[asyncStyle()]中运行失败！`)
                        console.log(error)
                    }
                }
                modulesTable.push({
                    name: module.title || module.name || 'UNKNOW',
                    type: module.type == 'plugin' ? '插件' : '标准模块',
                    version: module.version || '-'
                })
            }
            // 插入样式
            const style = document.createElement("style")
            style.appendChild(document.createTextNode(this.style))
            document.getElementsByTagName('head')[0].appendChild(style)
            // 初始化完成
            const endInitTime = new Date().getTime()
            console.table(modulesTable)
            this.printLog(`[v${this.getInfo().version}] 初始化完成: 共加载${this.modules.length}个模块，总耗时${endInitTime-startInitTime}ms`)
            console.log('%c反馈问题请前往: https://github.com/stone5265/GreasyFork-NGA-Check-Post-Status/issues', 'color:orangered;font-weight:bolder')
        }
        /**
         * 通知弹框
         * @method popNotification
         * @param {String} msg 消息内容
         * @param {Number} duration 显示时长(ms)
         */
        popNotification(msg, duration=1000) {
            $('#hld_cps_noti_container').length == 0 && $('body').append('<div id="hld_cps_noti_container"></div>')
            let $msgBox = $(`<div class="hld_cps_noti-msg">${msg}</div>`)
            $('#hld_cps_noti_container').append($msgBox)
            $msgBox.slideDown(100)
            setTimeout(() => { $msgBox.fadeOut(500) }, duration)
            setTimeout(() => { $msgBox.remove() }, duration + 500)
        }
        /**
         * 消息弹框
         * @method popMsg
         * @param {String} msg 消息内容
         * @param {String} type 消息类型 [ok, err, warn]
         */
        popMsg(msg, type='ok') {
            $('.hld_cps_msg').length > 0 && $('.hld_cps_msg').remove()
            let $msg = $(`<div class="hld_cps_msg hld_cps_msg-${type}">${msg}</div>`)
            $('body').append($msg)
            $msg.slideDown(200)
            setTimeout(() => { $msg.fadeOut(500) }, type == 'ok' ? 2000 : 5000)
            setTimeout(() => { $msg.remove() }, type == 'ok' ? 2500 : 5500)
        }
        /**
         * 打印控制台消息
         * @method printLog
         * @param {String} msg 消息内容
         */
        printLog(msg) {
            // console.log(`%cNGA%cScript%c ${msg}`,
            //     'background: #222;color: #fff;font-weight:bold;padding:2px 2px 2px 4px;border-radius:4px 0 0 4px;',
            //     'background: #fe9a00;color: #000;font-weight:bold;padding:2px 4px 2px 2px;border-radius:0px 4px 4px 0px;',
            //     'background:none;color:#000;'
            // )
            console.log(msg)
        }
        /**
         * 读取值
         * @method saveSetting
         * @param {String} key
         */
        getValue(key) {
            try {
                return GM_getValue(key) || window.localStorage.getItem(key)
            } catch {
                // 兼容性代码: 计划将在5.0之后废弃
                return window.localStorage.getItem(key)
            }
        }
        /**
         * 写入值
         * @method setValue
         * @param {String} key
         * @param {String} value
         */
        setValue(key, value) {
            try {
                GM_setValue(key, value)
            } catch {}
        }
        /**
         * 删除值
         * @method deleteValue
         * @param {String} key
         */
        deleteValue(key) {
            try {
                GM_deleteValue(key)
            } catch {}
            // 兼容性代码: 计划将在5.0之后废弃
            window.localStorage.removeItem(key)
        }
        /**
         * 保存配置到本地
         * @method saveSetting
         * @param {String} msg 自定义消息信息
         */
        saveSetting(msg='保存配置成功，刷新页面生效') {
            // // 基础设置
            // for (let k in this.setting.normal) {
            //     $('input#hld_cps_cb_' + k).length > 0 && (this.setting.normal[k] = $('input#hld_cps_cb_' + k)[0].checked)
            // }
            // script.setValue('hld_cps_NGA_setting', JSON.stringify(this.setting.normal))
            // 高级设置
            for (let k in this.setting.advanced) {
                if ($('#hld_cps_adv_' + k).length > 0) {
                    const originalSetting = this.setting.original.find(s => s.type == 'advanced' && s.key == k)
                    const valueType = typeof originalSetting.default
                    const inputType = $('#hld_cps_adv_' + k)[0].nodeName
                    if (inputType == 'SELECT') {
                        this.setting.advanced[k] = $('#hld_cps_adv_' + k).val()
                    } else {
                        if (valueType == 'boolean') {
                            this.setting.advanced[k] = $('#hld_cps_adv_' + k)[0].checked
                        }
                        if (valueType == 'number') {
                            this.setting.advanced[k] = Math.max($('#hld_cps_adv_' + k).val(), originalSetting.min || 0)
                        }
                        if (valueType == 'string') {
                            this.setting.advanced[k] = $('#hld_cps_adv_' + k).val()
                        }
                    }
                }
            }
            script.setValue('hld_cps_NGA_advanced_setting', JSON.stringify(this.setting.advanced))
            msg && this.popMsg(msg)
        }
        /**
         * 从本地读取配置
         * @method loadSetting
         */
        loadSetting() {
            // 基础设置
            try {
                // const settingStr = script.getValue('hld_cps_NGA_setting')
                // if (settingStr) {
                //     let localSetting = JSON.parse(settingStr)
                //     for (let k in this.setting.normal) {
                //         !localSetting.hasOwnProperty(k) && (localSetting[k] = this.setting.normal[k])
                //         if (k == 'shortcutKeys') {
                //             if (localSetting[k].length < this.setting.normal[k].length) {
                //                 const offset_count = this.setting.normal[k].length - localSetting[k].length
                //                 localSetting[k] = localSetting[k].concat(this.setting.normal[k].slice(-offset_count))
                //             }
                //             // 更改默认按键
                //             let index = 0
                //             for (const module of this.modules) {
                //                 if (module.setting && module.setting.shortCutCode) {
                //                     if (localSetting[k][index] != module.setting.shortCutCode) {
                //                         module.setting.rewriteShortCutCode = localSetting[k][index]
                //                     }
                //                     index += 1
                //                 }else if (module.settings) {
                //                     for (const setting of module.settings) {
                //                         if (setting.shortCutCode) {
                //                             if (localSetting[k][index] != setting.shortCutCode) {
                //                                 setting.rewriteShortCutCode = localSetting[k][index]
                //                             }
                //                             index += 1
                //                         }
                //                     }
                //                 }
                //             }
                //         }
                //     }
                //     for (let k in localSetting) {
                //         !this.setting.normal.hasOwnProperty(k) && delete localSetting[k]
                //     }
                //     this.setting.normal = localSetting
                // }
                // 高级设置
                const advancedSettingStr = script.getValue('hld_cps_NGA_advanced_setting')
                if (advancedSettingStr) {
                    let localAdvancedSetting = JSON.parse(advancedSettingStr)
                    for (let k in this.setting.advanced) {
                        !localAdvancedSetting.hasOwnProperty(k) && (localAdvancedSetting[k] = this.setting.advanced[k])
                    }
                    for (let k in localAdvancedSetting) {
                        !this.setting.advanced.hasOwnProperty(k) && delete localAdvancedSetting[k]
                    }
                    this.setting.advanced = localAdvancedSetting
                }
            } catch(e) {
                script.throwError(`读取配置文件出现错误，无法加载配置文件!\n错误问题: ${e}\n\n请尝试使用【修复脚本】来修复此问题`)
            }

        }
        // /**
        //  * 检查是否更新
        //  * @method checkUpdate
        //  */
        // checkUpdate() {
        //     // 字符串版本转数字
        //     const vstr2num = str => {
        //         let num = 0
        //         str.split('.').forEach((n, i) => num += i < 2 ? +n * 1000 / Math.pow(10, i) : +n)
        //         return num
        //     }
        //     // 字符串中版本截取
        //     const vstr2mid = str => {
        //         return str.substring(0, str.lastIndexOf('.'))
        //     }
        //     //检查更新
        //     const cver = script.getValue('hld_cps_NGA_version')
        //     if (cver) {
        //         const local_version = vstr2num(cver)
        //         const current_version = vstr2num(GM_info.script.version)
        //         if (current_version > local_version) {
        //             const lv_mid = +vstr2mid(cver)
        //             const cv_mid = +vstr2mid(GM_info.script.version)
        //             script.setValue('hld_cps_NGA_version', GM_info.script.version)
        //             if (cv_mid > lv_mid) {
        //                 const focus = ''
        //                 $('body').append(`<div id="hld_cps_updated" class="animated-1s bounce"><p><a href="javascript:void(0)" class="hld_cps_setting-close">×</a><b>NGA-Script已更新至v${GM_info.script.version}</b></p>${focus}<p><a class="hld_cps_readme" href="https://greasyfork.org/zh-CN/scripts/393991-nga%E4%BC%98%E5%8C%96%E6%91%B8%E9%B1%BC%E4%BD%93%E9%AA%8C" target="_blank">查看更新内容</a></p></div>`)
        //                 $('body').on('click', '#hld_cps_updated a', function () {
        //                     $(this).parents('#hld_cps_updated').remove()
        //                 })
        //             }
        //         }
        //     } else script.setValue('hld_cps_NGA_version', GM_info.script.version)
        // }
        /**
         * 创建储存对象实例
         * @param {String} instanceName 实例名称
         */
        createStorageInstance(instanceName) {
            if (!instanceName || Object.keys(this.store).includes(instanceName)) {
                this.throwError('创建储存对象实例失败，实例名称不能为空或实例名称已存在')
            }
            const lfInstance = localforage.createInstance({name: instanceName})
            this.store[instanceName] = lfInstance
            return lfInstance
        }
        /**
         * 运行脚本
         * @method run
         */
        run() {
            // this.checkUpdate()
            this.init()
            setInterval(() => {
                // this.renderAlways()
                this.isThreads() && this.renderThreads()
                this.isForms() && this.renderForms()
            }, 100)
        }
        /**
         * 获取脚本信息
         * @method getInfo
         * @return {Object} 脚本信息对象
         */
        getInfo() {
            return {
                version: GM_info.script.version,
                author: 'stone5265',
                github: 'https://github.com/stone5265/GreasyFork-NGA-Check-Post-Status',
            }
        }
    }

    /**
     * 设置模块
     * @name SettingPanel
     * @description 提供脚本的设置面板，提供配置修改，保存等基础功能
     */
    const SettingPanel = {
        name: 'SettingPanel',
        title: '设置模块',
        initFunc() {
            //设置面板
            let $panelDom = $(`
            <div id="hld_cps_setting_cover" class="animated zoomIn">
                <div id="hld_cps_setting_panel">
                    <a href="javascript:void(0)" id="hld_cps_setting_close" class="hld_cps_setting-close" close-type="hide">×</a>
                    <p class="hld_cps_sp-title">NGA检查帖子可见状态<span class="hld_cps_script-info">v${script.getInfo().version}</span><span class="hld_cps_script-info"> - 基于NGA优化摸鱼体验v4.5.4引擎</span></p>
                    <div style="clear:both"></div>
                    <div class="hld_cps_advanced-setting">
                        <div class="hld_cps_advanced-setting-panel">
                            <p>⚠ 鼠标停留在<span class="hld_cps_help" title="详细描述">选项文字</span>上可以显示详细描述，设置有误可能会导致插件异常或者无效！</p>
                            <table id="hld_cps_advanced_left"></table>
                            <table id="hld_cps_advanced_right"></table>
                        </div>
                    </div>
                    <div class="hld_cps_buttons">
                        <span id="hld_setting_panel_buttons"></span>
                        <span>
                            <button class="hld_cps_btn" id="hld_cps_reset__data">重置为默认设置</button>
                            <button class="hld_cps_btn" id="hld_cps_save__data">保存设置</button>
                        </span>
                    </div>
                </div>
            </div>
            `)
            const insertDom = setting => {
                if (setting.type === 'advanced') {
                    let formItem = ''
                    const valueType = typeof setting.default
                    if (valueType === 'boolean') {
                        formItem = `<input type="checkbox" id="hld_cps_adv_${setting.key}">`
                    }
                    if (valueType === 'number') {
                        formItem = `<input type="number" min="${setting.min || 0}" oninput="this.value = this.value.replace(/\\./g, '');" id="hld_cps_adv_${setting.key}">`
                    }
                    if (valueType === 'string') {
                        if (setting.options) {
                            let t = ''
                            for (const option of setting.options) {
                                t += `<option value="${option.value}">${option.label}</option>`
                            }
                            formItem = `<select id="hld_cps_adv_${setting.key}">${t}</select>`
                        } else {
                            formItem = `<input type="text" id="hld_cps_adv_${setting.key}">`
                        }
                    }
                    $panelDom.find(`#hld_cps_advanced_${setting.menu || 'left'}`).append(`
                    <tr>
                        <td><span class="hld_cps_help" help="${setting.desc || ''}">${setting.title || setting.key}</span></td>
                        <td>${formItem}</td>
                    </tr>`)
                }
            }
            for (const module of script.modules) {
                if (module.setting && module.setting.key) {
                    insertDom(module.setting)
                }
                if (module.settings) {
                    for (const setting of module.settings) {
                        setting.key && insertDom(setting)
                    }
                }
            }
            /**
             * Bind:Mouseover Mouseout
             * 提示信息Tips
             */
            $('body').on('mouseover', '.hld_cps_help', function(e){
                if (!$(this).attr('help')) return
                const $help = $(`<div class="hld_cps_help-tips">${$(this).attr('help').replace(/\n/g, '<br>')}</div>`)
                $help.css({
                    top: ($(this).offset().top + $(this).height() + 5) + 'px',
                    left: $(this).offset().left + 'px'
                })
                $('body').append($help)
            }).on('mouseout', '.hld_cps_help', ()=>$('.hld_cps_help-tips').remove())
            $('body').append($panelDom)
            //高级设置
            for (let k in script.setting.advanced) {
                if ($('#hld_cps_adv_' + k).length > 0) {
                    const valueType = typeof script.setting.advanced[k]
                    if (valueType == 'boolean') {
                        $('#hld_cps_adv_' + k)[0].checked = script.setting.advanced[k]
                    }
                    if (valueType == 'number' || valueType == 'string') {
                        $('#hld_cps_adv_' + k).val(script.setting.advanced[k])
                    }
                }
            }
            /**
             * Bind:Click
             * 关闭设置面板
             */
            $('body').on('click', '.hld_cps_setting-close', function () {
                if ($(this).attr('close-type') == 'hide') {
                    $(this).parent().hide()
                    $(this).parent().parent().hide()
                } else {
                    $(this).parent().remove()
                }
            })
            /**
             * Bind:Click
             * 保存配置
             */
            $('body').on('click', '#hld_cps_save__data', () => {
                script.saveSetting('')
                CheckPostStatus.reloadAutoCheckInfo()
                $('#hld_cps_setting_cover').fadeOut(200)
            })
            /**
             * Bind:Click
             * 重置为默认设置
             */
            $('body').on('click', '#hld_cps_reset__data', () => {
                if (window.confirm('重置为默认设置，这会清除脚本的大部分数据\n* 数据包含配置，上一次自动检查时间\n(不包括关注列表)\n* 此操作不可逆转，请谨慎操作\n\n继续请点击【确定】')) {
                    try {
                        GM_listValues().forEach(key => GM_deleteValue(key))
                    } catch {}
                    alert('操作成功，请刷新页面重试')
                }
            })
        },
        // renderAlwaysFunc() {
        //     if($('.hld_cps_setting-box').length == 0) {
        //         $('#startmenu > tbody > tr > td.last').append('<div><div class="item hld_cps_setting-box"></div></div>')
        //         let $entry = $('<a id="hld_cps_setting" title="打开NGA优化摸鱼插件设置面板">NGA优化摸鱼插件设置</a>')
        //         $entry.click(()=>{
        //             $('#hld_cps_setting_cover').css('display', 'block')
        //             $('html, body').animate({scrollTop: 0}, 500)
        //         })
        //         $('#hld_cps_setting_close').click(()=>$('#hld_cps_setting_cover').fadeOut(200))
        //         $('.hld_cps_setting-box').append($entry)
        //     }
        // },
        addButton(button) {
            const $button = $(`<button class="hld_cps_btn" id="${button.id}" title="${button.desc}">${button.title}</button>`)
            if (typeof button.click == 'function') {
                $button.on('click', function() {
                    button.click($(this))
                })
            }
            $('#hld_setting_panel_buttons').append($button)
        },
        style: `
        .animated {animation-duration:.3s;animation-fill-mode:both;}
        .animated-1s {animation-duration:1s;animation-fill-mode:both;}
        .zoomIn {animation-name:zoomIn;}
        .bounce {-webkit-animation-name:bounce;animation-name:bounce;-webkit-transform-origin:center bottom;transform-origin:center bottom;}
        .fadeInUp {-webkit-animation-name:fadeInUp;animation-name:fadeInUp;}
        #loader {display:none;position:absolute;top:50%;left:50%;margin-top:-10px;margin-left:-10px;width:20px;height:20px;border:6px dotted #FFF;border-radius:50%;-webkit-animation:1s loader linear infinite;animation:1s loader linear infinite;}
        @keyframes loader {0% {-webkit-transform:rotate(0deg);transform:rotate(0deg);}100% {-webkit-transform:rotate(360deg);transform:rotate(360deg);}}
        @keyframes zoomIn {from {opacity:0;-webkit-transform:scale3d(0.3,0.3,0.3);transform:scale3d(0.3,0.3,0.3);}50% {opacity:1;}}
        @keyframes bounce {from,20%,53%,80%,to {-webkit-animation-timing-function:cubic-bezier(0.215,0.61,0.355,1);animation-timing-function:cubic-bezier(0.215,0.61,0.355,1);-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0);}40%,43% {-webkit-animation-timing-function:cubic-bezier(0.755,0.05,0.855,0.06);animation-timing-function:cubic-bezier(0.755,0.05,0.855,0.06);-webkit-transform:translate3d(0,-30px,0);transform:translate3d(0,-30px,0);}70% {-webkit-animation-timing-function:cubic-bezier(0.755,0.05,0.855,0.06);animation-timing-function:cubic-bezier(0.755,0.05,0.855,0.06);-webkit-transform:translate3d(0,-15px,0);transform:translate3d(0,-15px,0);}90% {-webkit-transform:translate3d(0,-4px,0);transform:translate3d(0,-4px,0);}}
        @keyframes fadeInUp {from {opacity:0;-webkit-transform:translate3d(-50%,100%,0);transform:translate3d(-50%,100%,0);}to {opacity:1;-webkit-transform:translate3d(-50%,0,0);transform:translate3d(-50%,0,0);}}
        .hld_cps_msg{display:none;position:fixed;top:10px;left:50%;transform:translateX(-50%);color:#fff;text-align:center;z-index:99996;padding:10px 30px 10px 45px;font-size:16px;border-radius:10px;}
        .hld_cps_msg a{color:#fff;text-decoration: underline;}
        .hld_cps_msg-ok{background:#4bcc4b}
        .hld_cps_msg-err{background:#c33}
        .hld_cps_msg-warn{background:#FF9900}
        .hld_cps_flex{display:flex;}
        .hld_cps_float-left{float: left;}
        .clearfix {clear: both;}
        #hld_cps_noti_container {position:fixed;top:10px;left:10px;z-index:99;}
        .hld_cps_noti-msg {display:none;padding:10px 20px;font-size:14px;font-weight:bold;color:#fff;margin-bottom:10px;background:rgba(0,0,0,0.6);border-radius:10px;cursor:pointer;}
        .hld_cps_btn-groups {display:flex;justify-content:center !important;margin-top:10px;}
        button.hld_cps_btn {padding:3px 8px;border:1px solid #591804;background:#fff8e7;color:#591804;}
        button.hld_cps_btn:hover {background:#591804;color:#fff0cd;}
        button.hld_cps_btn[disabled] {opacity:.5;}
        #hld_cps_updated {position:fixed;top:20px;right:20px;width:230px;padding:10px;border-radius:5px;box-shadow:0 0 15px #666;border:1px solid #591804;background:#fff8e7;z-index: 9999;}
        #hld_cps_updated .hld_cps_readme {text-decoration:underline;color:#591804;}
        .hld_cps_script-info {margin-left:4px;font-size:70%;color:#666;}
        #hld_cps_setting {color:#6666CC;cursor:pointer;}
        #hld_cps_setting_cover {display:none;padding-top: 70px;position:absolute;top:0;left:0;right:0;bottom:0;z-index:999;}
        #hld_cps_setting_panel {position:relative;background:#fff8e7;width:700px;left: 50%;transform: translateX(-50%);padding:15px 20px;border-radius:10px;box-shadow:0 0 10px #666;border:1px solid #591804;}
        #hld_cps_setting_panel > div.hld_cps_field {float:left;width:50%;}
        #hld_cps_setting_panel p {margin-bottom:10px;}
        #hld_cps_setting_panel .hld_cps_sp-title {font-size:15px;font-weight:bold;text-align:center;}
        #hld_cps_setting_panel .hld_cps_sp-section {font-weight:bold;margin-top:20px;}
        .hld_cps_setting-close {position:absolute;top:5px;right:5px;padding:3px 6px;background:#fff0cd;color:#591804;transition:all .2s ease;cursor:pointer;border-radius:4px;text-decoration:none;z-index:9999;}
        .hld_cps_setting-close:hover {background:#591804;color:#fff0cd;text-decoration:none;}
        #hld_cps_setting_panel button {transition:all .2s ease;cursor:pointer;}
        .hld_cps_advanced-setting {border-top: 1px solid #e0c19e;border-bottom: 1px solid #e0c19e;padding: 3px 0;margin-top:25px;}
        .hld_cps_advanced-setting >span {font-weight:bold}
        .hld_cps_advanced-setting >button {padding: 0px;margin-right:5px;width: 18px;text-align: center;}
        .hld_cps_advanced-setting-panel {display:flex;padding:5px 0;flex-wrap: wrap;}
        .hld_cps_advanced-setting-panel>p {width:100%;}
        .hld_cps_advanced-setting-panel>table {width:50%;}
        .hld_cps_advanced-setting-panel>p {margin: 7px 0 !important;font-weight:bold;}
        .hld_cps_advanced-setting-panel>p svg {height:16px;width:16px;vertical-align: top;margin-right:3px;}
        .hld_cps_advanced-setting-panel>table td {padding-right:10px}
        .hld_cps_advanced-setting-panel input[type=text],.hld_cps_advanced-setting-panel input[type=number] {width:80px}
        .hld_cps_advanced-setting-panel input[type=number] {border: 1px solid #e6c3a8;box-shadow: 0 0 2px 0 #7c766d inset;border-radius: 0.25em;}
        .hld_cps_help {cursor:help;text-decoration: underline;}
        .hld_cps_buttons {clear:both;display:flex;justify-content:space-between;padding-top:15px;}
        button.hld_cps_btn {padding:3px 8px;border:1px solid #591804;background:#fff8e7;color:#591804;}
        button.hld_cps_btn:hover {background:#591804;color:#fff0cd;}
        .hld_cps_sp-fold {padding-left:23px;}
        .hld_cps_sp-fold .hld_cps_f-title {font-weight:bold;}
        .hld_cps_help-tips {position: absolute;padding: 5px 10px;background: rgba(0,0,0,.8);color: #FFF;border-radius: 5px;z-index: 9999;}
        `
    }

    /**
     * 初始化脚本
     */
    const script = new NGABBSScript_CheckPostStatus()
    /**
     * 添加模块
     */
    script.addModule(SettingPanel)
    script.addModule(CheckPostStatus)
    /**
     * 运行脚本
     */
    script.run()
})();