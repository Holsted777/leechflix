var gui = require('nw.gui')
var swig = require('swig')
var async = require('async')

var scrapermain = require('./scrapers/scrapermain.js')
var tlscraper = require('./scrapers/tl.js')
var iptscraper = require('./scrapers/ipt.js')
var streamer = require('./streamer.js')
var config = require('./config.js')

var appTemplate = swig.compileFile('./templates/app.html')
var movieLibraryTemplate = swig.compileFile('./templates/movieLibrary.html')
var movieDetails = swig.compileFile('./templates/movieDetails.html')

var currentScraper
var currentMovies
var currentUrl

function start () {
  initCore(function () {
    currentUrl = config.urls.ipt.moviesNew
    setIptScraper()
    fetch(currentUrl)
  })
}

function initCore (callback) {
  async.series([
    function (done) {
      scrapermain.login(config.urls.tl.login, config.credentials.tl, function (err) {
        done(err)
      })
    },
    function (done) {
      scrapermain.login(config.urls.ipt.login, config.credentials.ipt, function (err) {
        done(err)
      })
    }
  ], function (err) {
    callback(err)
  })
}

function fetch () {
  scrapermain.fetch(currentUrl, currentScraper, function (err, res) {
    if (err) {
      console.log('err' + err)
    } else {
      currentMovies = res
      sendItemsToView()
    }
  })
}

function play (torrentUrl) {
  scrapermain.downloadTorrent(torrentUrl, function (err, path) {
    if (err) console.log(err)
    else streamer.play(path)
  })
}

function sendItemsToView () {
  document.body.innerHTML = (appTemplate())
  if (currentMovies !== null) {
    document.getElementById('movieLibrary_content').innerHTML = (movieLibraryTemplate({movies: currentMovies}))
  } else {
    document.getElementById('movieLibrary_content').innerHTML = ''
  }
  initUI()
}

function initUI () {
  $('#overlayMovie').easyModal()
}

function showMovieOverlay (position) {
  var movie = currentMovies[position]
  document.getElementById('overlayMovie').innerHTML = (movieDetails({movie: movie}))
  $('#overlayMovie').trigger('openModal')
}

function getTlSearchUrl (term) {
  return config.urls.tl.searchBeg + term.replace(' ', '+') + config.urls.tl.searchEnd
}

function openLink (link) {
  gui.Shell.openExternal(link)
}

/*
Page navigation
*/

function goTlNextPage () {
  var index = parseInt(currentUrl.substring(currentUrl.length - 1, currentUrl.length)) + 1
  currentUrl = currentUrl.substring(0, currentUrl.length - 1) + index.toString()
  fetch()
}

function goTlPrevPage () {
  var index = parseInt(currentUrl.substring(currentUrl.length - 1, currentUrl.length))
  if (index > 1) {
    index = index - 1
    currentUrl = currentUrl.substring(0, currentUrl.length - 1) + index.toString()
    fetch()
  }
}

/*
Browse most popular movies added in the given timeframe
*/
function goTlPopPage (term) {
  /*
  Example valid terms:
  24HOURS, 7DAYS, 2MONTHS, 1YEAR (weeks not working..?)
  */
  currentUrl = config.urls.tl.moviesPopBeg + term + config.urls.tl.moviesPopEnd
  setTlScraper()
  fetch()
}

function goTlNewPage () {
  currentUrl = config.urls.tl.moviesNew
  setTlScraper()
  fetch()
}

function goIptNewPage () {
  currentUrl = config.urls.ipt.moviesNew
  setIptScraper()
  fetch()
}

function setTlScraper() {
  currentScraper = tlscraper
}

function setIptScraper() {
  currentScraper = iptscraper
}
