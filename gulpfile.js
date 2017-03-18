var gulp = require("gulp");
var babel = require("gulp-babel");
var sourceMaps = require("gulp-sourcemaps");
var concat = require("gulp-concat");
var pump = require('pump');

gulp.task("babel-prod", function () {
    return gulp.src("src/**/*.js")
        .pipe(babel())
        .pipe(gulp.dest("dist"));
});

gulp.task("default", function () {
    return gulp.src("src/**/*.js")
        .pipe(sourceMaps.init())
        .pipe(babel())
        .pipe(sourceMaps.write("."))
        .pipe(gulp.dest("dist"));
});
