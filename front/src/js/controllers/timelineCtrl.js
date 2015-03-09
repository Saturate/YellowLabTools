var timelineCtrl = angular.module('timelineCtrl', []);

timelineCtrl.controller('TimelineCtrl', ['$scope', '$rootScope', '$routeParams', '$location', '$timeout', 'Menu', 'Results', 'API', function($scope, $rootScope, $routeParams, $location, $timeout, Menu, Results, API) {
    $scope.runId = $routeParams.runId;
    $scope.Menu = Menu.setCurrentPage('timeline', $scope.runId);

    function loadResults() {
        // Load result if needed
        if (!$rootScope.loadedResult || $rootScope.loadedResult.runId !== $routeParams.runId) {
            Results.get({runId: $routeParams.runId}, function(result) {
                $rootScope.loadedResult = result;
                $scope.result = result;
                render();
            });
        } else {
            $scope.result = $rootScope.loadedResult;
            render();
        }
    }

    function render() {
        initScriptFiltering();
        initExecutionTree();
        initTimeline();
        $timeout(initProfiler, 100);
    }

    function initScriptFiltering() {
        var offenders = $scope.result.rules.jsCount.offendersObj.list;
        $scope.scripts = [];

        offenders.forEach(function(script) {
            var filePath = script.file;

            if (filePath.length > 100) {
                filePath = filePath.substr(0, 98) + '...';
            }

            var scriptObj = {
                fullPath: script.file, 
                shortPath: filePath
            };

            $scope.scripts.push(scriptObj);
        });
    }

    function initExecutionTree() {
        var originalExecutions = $scope.result.javascriptExecutionTree.children || [];
        
        // Detect the last event of all (before filtering) and read time
        var lastEvent = originalExecutions[originalExecutions.length - 1];
        $scope.endTime =  lastEvent.data.timestamp + (lastEvent.data.time || 0);

        // Filter
        $scope.executionTree = [];
        originalExecutions.forEach(function(node) {
            
            // Filter by script (if enabled)
            if ($scope.selectedScript) {
                if (node.data.backtrace && node.data.backtrace.indexOf($scope.selectedScript.fullPath + ':') === -1) {
                    return;
                }
                if (node.data.type === "jQuery loaded" || node.data.type === "jQuery version change") {
                    return;
                }
            }

            $scope.executionTree.push(node);
        });
    }

    function initTimeline() {

        // Split the timeline into 200 intervals
        var numberOfIntervals = 199;
        $scope.timelineIntervalDuration = $scope.endTime / numberOfIntervals;
        
        // Pre-fill array of as many elements as there are milleseconds
        var millisecondsArray = Array.apply(null, new Array($scope.endTime + 1)).map(Number.prototype.valueOf,0);
        
        // Create the milliseconds array from the execution tree
        $scope.executionTree.forEach(function(node) {
            if (node.data.time !== undefined) {

                // Ignore artefacts (durations > 100ms)
                var time = Math.min(node.data.time, 100) || 1;

                for (var i=node.data.timestamp, max=node.data.timestamp + time ; i<max ; i++) {
                    millisecondsArray[i] |= 1;
                }
            }
        });

        // Pre-fill array of 200 elements
        $scope.timeline = Array.apply(null, new Array(numberOfIntervals + 1)).map(Number.prototype.valueOf,0);

        // Create the timeline from the milliseconds array
        millisecondsArray.forEach(function(value, timestamp) {
            if (value === 1) {
                $scope.timeline[Math.floor(timestamp / $scope.timelineIntervalDuration)] += 1;
            }
        });
        
        // Get the maximum value of the array (needed for display)
        $scope.timelineMax = Math.max.apply(Math, $scope.timeline);
    }


    function initProfiler() {
        $scope.profilerData = $scope.executionTree;
    }


    function parseBacktrace(str) {
        if (!str) {
            return null;
        }

        var out = [];
        var splited = str.split(' / ');
        splited.forEach(function(trace) {
            var fnName = null, fileAndLine;

            var withFnResult = /^([^\s\(]+) \((.+:\d+)\)$/.exec(trace);
            if (withFnResult === null) {
                fileAndLine = trace;
            } else {
                fnName = withFnResult[1];
                fileAndLine = withFnResult[2];
            }

            var fileAndLineSplit = /^(.*):(\d+)$/.exec(fileAndLine);
            var filePath = fileAndLineSplit[1];
            var line = fileAndLineSplit[2];

            out.push({
                fnName: fnName,
                filePath: filePath,
                line: line
            });
        });
        return out;
    }

    $scope.changeScript = function() {
        initExecutionTree();
        initTimeline();
        initProfiler();
    };

    $scope.findLineIndexByTimestamp = function(timestamp) {
        var lineIndex = 0;

        for (var i = 0; i < $scope.executionTree.length; i ++) {
            var delta = $scope.executionTree[i].data.timestamp - timestamp;
            
            if (delta < $scope.timelineIntervalDuration) {
                lineIndex = i;
            }

            if (delta > 0) {
                break;
            }
        }

        return lineIndex;
    };

    $scope.onNodeDetailsClick = function(node) {
        var isOpen = node.showDetails;
        if (!isOpen) {
            // Close all other nodes
            $scope.executionTree.forEach(function(currentNode) {
                currentNode.showDetails = false;
            });

            // Parse the backtrace
            if (!node.parsedBacktrace) {
                node.parsedBacktrace = parseBacktrace(node.data.backtrace);
            }

        }
        node.showDetails = !isOpen;
    };

    $scope.isStringOfObject = function(str) {
        return typeof str === 'string' && str[0] === '{' && str[str.length - 1] === '}';
    };

    $scope.isPureString = function(str) {
        return typeof str === 'string' && str[0] !== '{' && str !== '(function)' && str !== '[Object]' && str !== '[Array]' && str !== 'true' && str !== 'false' && str !== 'undefined' && str !== 'unknown';
    };


    $scope.backToDashboard = function() {
        $location.path('/result/' + $scope.runId);
    };

    $scope.testAgain = function() {
        API.launchTest($scope.result.params.url);
    };

    loadResults();

}]);

timelineCtrl.directive('scrollOnClick', ['$animate', '$timeout', function($animate, $timeout) {
    return {
        restrict: 'A',
        link: function (scope, element, attributes) {            
            // When the user clicks on the timeline, find the right profiler line and scroll to it
            element.on('click', function() {
                var lineIndex = scope.findLineIndexByTimestamp(attributes.scrollOnClick);
                var lineElement = angular.element(document.getElementById('line_' + lineIndex));
                
                // Animate the background color to "flash" the row
                lineElement.addClass('highlight');
                $timeout(function() {
                    $animate.removeClass(lineElement, 'highlight');
                    scope.$digest();
                }, 50);


                window.scrollTo(0, lineElement[0].offsetTop);
                console.log(lineElement[0]);
            });
        }
    };
}]);
