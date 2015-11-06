var scraperhelper = require('./scraperhelper.js')
var config = require('./config')
var cheerio = require('cheerio')
var spawn = require('child_process').spawn
var fs = require('fs')
var async = require('async')
var omdb = require('omdb')
var FileCookieStore = require('tough-cookie-filestore')
var request = require('request')
var WebTorrent = require('webtorrent')

/*
Initialize cookie file which stores the login info
*/
try {
  fs.openSync(config.cookiePath, 'r')
} catch (e) {
  if (e.code === 'ENOENT') {
		// File not found, so make one
    fs.writeFileSync(config.cookiePath, '', { flags: 'wx' }, function (err) {
      if (err) {
        console.log(err)
        throw err
      }
    })
  } else {
    console.log(e)
    throw e
  }
}

var j = request.jar(new FileCookieStore(config.cookiePath))
request = request.defaults({ jar: j })

/*
Requires login
*/
exports.fetch = function (url, callback) {
  scrapeTorrents(url, function (err, results) {
    if (err) {
      console.log(err)
      callback(err, null)
    } else {
      callback(null,
			scraperhelper.sortMoviesByImdbRating(
      scraperhelper.sortReleasesBySeeders(results)))
    }
  })
}

exports.login = function (callback) {
  request.post({
    uri: config.urls.login,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: require('querystring').stringify(config.credentials)
  }, function (err, res, body) {
    if (err) {
      console.log('Login error: ' + err)
      callback(err, null)
    } else {
      console.log('Login successful')
      callback(null, body)
    }
  })
}

function scrapeTorrents (url, callback) {
  request(url, function (err, res, body) {
    if (err) {
      console.log('Error scraping ' + url + ': ' + err)
      callback(err, null)
      return
    }
    var $ = cheerio.load(body)
    var results = []
    var asyncTasks = []
    $('span.title').each(function (i, element) {
      var name = $(this).text()
      var detailsUrl = $(this).children().eq(0).attr('href')
      var torrentUrl = $(this).parent().next().children().eq(0).attr('href')
      var size = $(this).parent().next().next().next().text()
      var seeders = $(this).parent().next().next().next().next().next().text()
      var leechers = $(this).parent().next().next().next().next().next().next().text()

      var info = scraperhelper.extractInfoFromName(name)
      var searchTerm = {terms: info.title, year: info.year, specialChars: true}

      asyncTasks.push(function (callback) {
        getOmdbInfo(searchTerm, function (err, res) {
          var omdbInfo
          var isCollection // Movies not found in OMDb gets collected into one item
          if (err) {
            isCollection = true
            info.rlsDetails = name
            omdbInfo = {title: 'Not found in IMDb', year: '', runtime: '', actors: '', plot: '', imdb: {id: '', rating: 10, votes: 0}, poster: '../static/folder2.jpg'}
          } else {
            omdbInfo = res
            isCollection = false
            omdbInfo.genres = omdbInfo.genres.map(function (s) { return ' ' + s })
            omdbInfo.genres[0] = omdbInfo.genres[0].substring(1)
          }

          var movieInfo = {
            isCollection: isCollection,
            title: omdbInfo.title,
            year: omdbInfo.year,
            release: [{
              rlsDetails: info.rlsDetails,
              detailsUrl: detailsUrl,
              torrentUrl: torrentUrl,
              size: size,
              seeders: seeders,
              leechers: leechers
            }],
            runtime: omdbInfo.runtime,
            genres: omdbInfo.genres,
            actors: omdbInfo.actors,
            plot: omdbInfo.plot,
            imdbId: omdbInfo.imdb.id,
            imdbRating: omdbInfo.imdb.rating,
            imdbVotes: omdbInfo.imdb.votes,
            imgUrl: omdbInfo.poster
          }

          var added = false
          for (var j = 0; j < results.length; j++) {
            if (results[j].imdbId === movieInfo.imdbId) {
              results[j].release.push(movieInfo.release[0])
              added = true
              break
            }
          }
          if (!added) {
            results.push(movieInfo)
          }
          callback()
        })
      })
    })

    async.parallel(asyncTasks, function () {
      callback(null, results)
    })
  })
}

function getOmdbInfo (show, callback) {
  show.type = 'movie'
  omdb.search(show, function (err, movies) {
    if (err) {
      callback(err, null)
    }
    if (movies.length === 0) {
      if (show.specialChars === true) {
        // Replace special charactes with whitespace and retry OMDb search
        show.terms = show.terms.replace(/[^a-z0-9\s]/gi, '')
        show.terms = show.terms.replace(/\s+/g, ' ')
        show.specialChars = false
        getOmdbInfo(show, function (err, res) {
          callback(err, res)
        })
      } else {
        console.log('No OMDb search results for: ' + show.terms + ' ' + show.year)
        callback('No search results for: ' + show.terms + ' ' + show.year, null)
      }
    } else {
      omdb.get(movies[0].imdb, true, function (err, movie) {
        if (err) {
          callback(err, null)
        }
        if (!movie) {
          console.log('No OMDb get result for: ' + show.terms + ' ' + show.year + ' ' + movies[0].imdb)
          callback('Movie not found!', null)
        } else {
          callback(null, movie)
        }
      })
    }
  })
}

// play('/download/667457/Ant.Man.2015.1080p.HDRip.X264.AC3-EVO.torrent')

exports.play = function (torrentUrl) {
  downloadTorrent(torrentUrl, function (err, path) {
    if (err) {
      console.log(err)
    } else {
      launchWebtorrent(path)
    }
  })
}

function downloadTorrent (url, callback) {
  var dir = config.torrentDir
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir)
  }
  var filename = url.split('/')
  var path = dir + filename[filename.length - 1]
  var uri = 'http://torrentleech.org' + url
  request({uri: uri})
    .on('error', function (err) {
      console.log('Download torrent err: ' + err + ' for ' + url)
      callback(err, null)
      return
    })
		.pipe(fs.createWriteStream(path))
    .on('close', function () {
      callback(null, path)
    }
  )
}

function launchWebtorrent (torrentFilePath) {
  var client = new WebTorrent()
  client.add(torrentFilePath, function ontorrent (torrent) {
    var server = torrent.createServer()
    server.listen(config.port)
    var biggestIdx = 0
    for (var i = 1 ; i < torrent.files.length; i++) {
      if (torrent.files[i].length > torrent.files[biggestIdx].length) {
        biggestIdx = i
      }
    }
    var url = 'http://localhost:' + config.port + '/' + biggestIdx
    console.log(torrent.files[biggestIdx].name + ' available at ' + url)
    launchVideoPlayer(url)
		/*
    @TODO: need to close and destroy when finished wathing movie
		server.close()
		client.destroy()
		*/
		/*
    @TODO feature: show download progress
		torrent.on('download', function(chunkSize){
		  console.log('chunk size: ' + chunkSize);
		  console.log('total downloaded: ' + torrent.downloaded);
		  console.log('download speed: ' + torrent.downloadSpeed());
		  console.log('progress: ' + torrent.progress);
		  console.log('======');
		  })
  		*/
  })
}

function launchVideoPlayer (url) {
  /*
  @TODO feature: remember playing position and resume there
  /start ms		Start playing at "ms" (= milliseconds)
  /startpos hh:mm:ss	Start playing at position hh:mm:ss
  */
  var child = spawn(config.players.mpchc, [url, '/play'])
  child.on('error', function (err) {
    console.log('Failed to start child process: ' + err)
  })
}

function launchPeerflix (torrentFilePath) {
  var args = '--mpchc'
  var child = spawn('cmd', ['/c', 'peerflix', torrentFilePath, args])
  child.on('error', function (err) {
    console.log('Failed to start child process: ' + err)
  })
}
