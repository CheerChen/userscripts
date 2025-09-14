// 三种提取格式的番号识别
export function extractKeyword(fileName, isFile = false) {
    // 对于文件和文件夹，都去掉扩展名，因为扩展名通常不包含番号信息
    // 而且可能造成误判（如 .mp4 被识别为 mp-4）
    const cleanName = fileName.replace(/\.[^.]+$/, '');
    
    // 处理前导0的函数：保留最少3位数字
    function cleanLeadingZeros(numberStr) {
        // 先去掉所有前导0，看看实际的数字位数
        const withoutLeadingZeros = numberStr.replace(/^0+/, '') || '0';
        const actualDigits = withoutLeadingZeros.length;
        
        // 如果去掉前导0后的数字位数 >= 3位，则去除前导0
        if (actualDigits >= 3) {
            return withoutLeadingZeros;
        }
        // 如果去掉前导0后的数字位数 < 3位，则补足到3位
        return withoutLeadingZeros.padStart(3, '0');
    }
    
    // 使用全局匹配找到所有可能的番号，然后取最后一个
    let allMatches = [];
    
    // 格式1: 标准格式 ABC-123 (优先级最高)
    let matches = [...cleanName.matchAll(/([a-zA-Z]+)-(\d+)/g)];
    matches.forEach(match => {
        // 检查原始数字部分长度（包括前导0），少于3位不认为是番号
        if (match[2].length < 3) {
            return; // 跳过数字部分少于3位的匹配
        }
        
        const cleanedNumber = cleanLeadingZeros(match[2]);
        allMatches.push({
            format: 'standard',
            keyword: `${match[1].toLowerCase()}-${cleanedNumber}`,
            originalMatch: match[0], // 保存原始匹配
            series: match[1].toLowerCase(),
            number: cleanedNumber,
            index: match.index,
            priority: 1
        });
    });
    
    // 格式2: 无连字符 ABC123  
    matches = [...cleanName.matchAll(/([a-zA-Z]+)(\d+)/g)];
    matches.forEach(match => {
        // 检查原始数字部分长度（包括前导0），少于3位不认为是番号
        if (match[2].length < 3) {
            return; // 跳过数字部分少于3位的匹配
        }
        
        const cleanedNumber = cleanLeadingZeros(match[2]);
        allMatches.push({
            format: 'no-dash',
            keyword: `${match[1].toLowerCase()}-${cleanedNumber}`,
            originalMatch: match[0], // 保存原始匹配
            series: match[1].toLowerCase(), 
            number: cleanedNumber,
            index: match.index,
            priority: 2
        });
    });
    
    // 格式3: 通用匹配
    matches = [...cleanName.matchAll(/([a-zA-Z]{3,})(\d+)/g)];
    matches.forEach(match => {
        // 检查原始数字部分长度（包括前导0），少于3位不认为是番号
        if (match[2].length < 3) {
            return; // 跳过数字部分少于3位的匹配
        }
        
        const cleanedNumber = cleanLeadingZeros(match[2]);
        allMatches.push({
            format: 'generic',
            keyword: `${match[1].toLowerCase()}-${cleanedNumber}`,
            originalMatch: match[0], // 保存原始匹配
            series: match[1].toLowerCase(),
            number: cleanedNumber,
            index: match.index,
            priority: 3
        });
    });
    
    if (allMatches.length === 0) {
        return null;
    }
    
    // 按位置排序（最后出现的优先），如果位置相同则按优先级排序
    allMatches.sort((a, b) => {
        if (a.index !== b.index) {
            return b.index - a.index; // 位置越靠后越优先
        }
        return a.priority - b.priority; // 优先级越小越优先
    });
    
    const result = allMatches[0];
    return {
        format: result.format,
        keyword: result.keyword,
        originalMatch: result.originalMatch,
        series: result.series,
        number: result.number
    };
}

// 构建直接访问URL
function buildDirectAccessUrl(keyword) {
    return `https://av-wiki.net/${keyword.toLowerCase()}/`;
}

// 构建搜索URL
function buildSearchUrl(searchTerm) {
    return `https://av-wiki.net/?s=${encodeURIComponent(searchTerm)}&post_type=product`;
}

// 为了测试目的而保留的函数，实际逻辑已整合到主要函数中
export function predictDirectAccess(keyword) {
    if (!keyword) {
        return {
            url: '',
            likely: false
        };
    }
    
    return {
        url: buildDirectAccessUrl(keyword),
        likely: keyword.match(/^[a-zA-Z]+-\d+$/) !== null
    };
}

// 为了测试目的而保留的函数，实际逻辑已整合到主要函数中
export function getSearchFallback(originalMatch) {
    if (!originalMatch) {
        return {
            searchUrl: '',
        };
    }
    
    return {
        searchUrl: buildSearchUrl(originalMatch),
    };
}

// 获取回退搜索的详情页链接
export function getFallbackDetailUrl(searchTerm) {
    return new Promise((resolve, reject) => {
        if (!searchTerm) {
            resolve(null);
            return;
        }

        const searchUrl = buildSearchUrl(searchTerm);
        
        httpRequest({
            method: "GET",
            url: searchUrl
        }).then(function(response) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.responseText, "text/html");
            const listItems = doc.querySelectorAll('.read-more a');

            const seriesMatch = searchTerm.match(/[a-zA-Z]+/);
            if (!seriesMatch) {
                resolve(null);
                return;
            }
            const seriesName = seriesMatch[0].toLowerCase();
            const keywordRegex = new RegExp(seriesName, 'i');
            
            for (let item of listItems) {
                const href = item.href;
                if (href && keywordRegex.test(href.toLowerCase())) {
                    resolve(href);
                    return;
                }
            }
            
            resolve(null);
        }).catch(function(error) {
            console.error(`[getFallbackDetailUrl] HTTP request failed:`, error);
            resolve(null);
        });
    });
}

// HTTP 请求适配器 - 在测试环境使用代理，在 userscript 环境使用 GM_xmlhttpRequest
function httpRequest(options) {
    return new Promise((resolve, reject) => {
        // 检查是否在 userscript 环境中
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                onload: function(response) {
                    resolve({
                        status: response.status,
                        responseText: response.responseText
                    });
                },
                onerror: function(error) {
                    reject(new Error(`Request failed: ${error.statusText || 'Network error'}`));
                },
                ontimeout: function() {
                    reject(new Error('Request timeout'));
                }
            });
        } else {
            // 测试环境中使用代理服务器
            const proxyUrl = `http://localhost:3001?url=${encodeURIComponent(options.url)}`;
            fetch(proxyUrl, {
                method: options.method || 'GET'
            })
            .then(response => response.text())
            .then(responseText => {
                resolve({
                    status: 200,
                    responseText: responseText
                });
            })
            .catch(reject);
        }
    });
}

// 解析详情页内容，提取标题和日期
function parseDetailPage(responseText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(responseText, "text/html");
    const ogTitle = doc.querySelector('.blockquote-like p');
    const dateElement = doc.querySelector('time.date.published');

    let name = ogTitle ? ogTitle.textContent : null;
    let date = dateElement ? dateElement.getAttribute('datetime') : null;

    if (name) {
        name = name.replace(/[\/:*?"<>|\x00-\x1F]/g, '_');
    }
    return { title: name, date: date };
}

// Query DMM API for title and date
export function queryDMM(extractionResult, dmmConfig = null) {
    return new Promise((resolve, reject) => {
        if (!extractionResult?.keyword) {
            return reject('Invalid extraction result provided.');
        }

        if (!dmmConfig && typeof window !== 'undefined' && window.PikPakRenamerConfig) {
            dmmConfig = window.PikPakRenamerConfig.dmm;
        }

        if (!dmmConfig?.enabled) {
            return reject('DMM query not enabled or configured');
        }

        if (!dmmConfig.apiId || !dmmConfig.affiliateId) {
            return reject('DMM API configuration incomplete');
        }
        
        const searchQuery = `${extractionResult.series}00${extractionResult.number}`;
        const apiUrl = new URL('https://api.dmm.com/affiliate/v3/ItemList');
        
        apiUrl.searchParams.set('api_id', dmmConfig.apiId);
        apiUrl.searchParams.set('affiliate_id', dmmConfig.affiliateId);
        apiUrl.searchParams.set('site', 'FANZA');
        apiUrl.searchParams.set('keyword', searchQuery);
        apiUrl.searchParams.set('output', 'json');

        console.log(`[queryDMM] Searching: ${searchQuery}`);

        httpRequest({ method: "GET", url: apiUrl.toString() })
            .then(response => {
                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}`);
                }

                let jsonData;
                try {
                    jsonData = JSON.parse(response.responseText);
                } catch (parseError) {
                    throw new Error('API response parsing failed');
                }

                if (jsonData.result?.status !== 200) {
                    throw new Error(`API error: ${jsonData.result?.message || 'Unknown error'}`);
                }

                if (!jsonData.result?.items?.length) {
                    throw new Error('No matching videos found');
                }

                const firstItem = jsonData.result.items[0];
                let title = firstItem.title;
                let date = firstItem.date;
                
                if (title) {
                    title = title.replace(/[\/:*?"<>|\x00-\x1F]/g, '_');
                }
                
                if (date?.includes(' ')) {
                    date = date.split(' ')[0];
                }
                
                if (!title) {
                    throw new Error('API returned incomplete data');
                }

                const finalTitle = `【${extractionResult.keyword.toUpperCase()}】${title}`;
                
                console.log(`[queryDMM] Success: ${extractionResult.keyword} -> ${finalTitle}`);
                resolve({ 
                    title: finalTitle, 
                    date: date || null
                });
            })
            .catch(error => {
                console.error(`[queryDMM] Failed: ${extractionResult.keyword}`, error);
                reject(`DMM query failed: ${error.message}`);
            });
    });
}

// 查询AV-wiki获取标题和日期
export function queryAVwiki(extractionResult) {
    return new Promise((resolve, reject) => {
        if (!extractionResult || !extractionResult.keyword) {
            return reject('Invalid extraction result provided.');
        }

        const directUrl = buildDirectAccessUrl(extractionResult.keyword);

        httpRequest({ method: "GET", url: directUrl })
            .then(response => {
                // 检查是否成功获取到详情页
                if (response.status === 200 && response.responseText.includes('blockquote-like')) {
                    const { title, date } = parseDetailPage(response.responseText);
                    if (title) {
                        console.log(`[queryAVwiki] DirectAccess 成功: ${extractionResult.keyword}`);
                        resolve({ title, date });
                        return; // 成功，终止Promise链
                    }
                }
                // 若无有效标题或页面结构不对，抛出错误进入fallback
                console.log(`[queryAVwiki] DirectAccess 失败，准备进入 Fallback: ${extractionResult.keyword}`);
                throw new Error('Direct access failed or page content invalid.');
            })
            .catch(async () => {
                // 直接访问失败，回退到搜索方式
                console.log(`[queryAVwiki] 开始 Fallback 搜索: ${extractionResult.originalMatch}`);
                try {
                    const detailUrl = await getFallbackDetailUrl(extractionResult.originalMatch);
                    if (detailUrl) {
                        const detailResponse = await httpRequest({ method: "GET", url: detailUrl });
                        const { title, date } = parseDetailPage(detailResponse.responseText);
                        if (title) {
                            console.log(`[queryAVwiki] Fallback 成功: ${extractionResult.originalMatch} -> ${detailUrl}`);
                            resolve({ title, date });
                        } else {
                            console.log(`[queryAVwiki] Fallback 失败 - 未找到标题: ${extractionResult.originalMatch}`);
                            reject('未找到标题 (Fallback)');
                        }
                    } else {
                        console.log(`[queryAVwiki] Fallback 失败 - 未找到匹配的番号: ${extractionResult.originalMatch}`);
                        reject('未找到匹配的番号 (Fallback)');
                    }
                } catch (fallbackError) {
                    console.error(`[queryAVwiki] Fallback 网络请求失败: ${extractionResult.originalMatch}`, fallbackError);
                    reject('网络请求失败 (Fallback)');
                }
            });
    });
}
